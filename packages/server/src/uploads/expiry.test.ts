import assert from "node:assert/strict"
import test from "node:test"

import { JOB_KINDS } from "@alloy/contracts"
import { uploadTicket } from "@alloy/db/schema"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"

import {
  UPLOAD_EXPIRY_DUE_SQL,
  UPLOAD_EXPIRY_NEXT_SQL,
  UploadExpiryCoordinator,
  commitUploadInitiateAndWake,
  type UploadExpiryCandidate,
  type UploadExpiryExclusions,
  type UploadExpiryStore,
} from "./expiry"
import { expiredOrphanUploadTicketPredicate } from "./tickets"

const clipCandidate = candidate("clip", "11111111-1111-4111-8111-111111111111")
const ticketCandidate = candidate(
  "ticket",
  "22222222-2222-4222-8222-222222222222",
)

test("due work is bounded and globally ordered across both deadline indexes", () => {
  assert.equal([...UPLOAD_EXPIRY_DUE_SQL.matchAll(/limit \$1/g)].length, 3)
  assert.match(
    UPLOAD_EXPIRY_DUE_SQL,
    /order by candidates\.deadline, candidates\.kind, candidates\.id/,
  )
  assert.match(
    UPLOAD_EXPIRY_DUE_SQL,
    /clip\.upload_cleanup_at <= clock\.cutoff/,
  )
  assert.match(
    UPLOAD_EXPIRY_DUE_SQL,
    /upload_ticket\.expires_at <= \(clock\.cutoff at time zone 'UTC'\)/,
  )
  assert.match(
    UPLOAD_EXPIRY_DUE_SQL,
    /upload_ticket\.expires_at at time zone 'UTC' as deadline/,
  )
})

test("due and next queries leave active clip tickets to domain owners", () => {
  for (const query of [UPLOAD_EXPIRY_DUE_SQL, UPLOAD_EXPIRY_NEXT_SQL]) {
    assert.match(
      query,
      /not exists \([\s\S]*owner\.id = upload_ticket\.target_id[\s\S]*owner\.status in \('pending', 'processing'\)/,
    )
  }
  assert.match(
    UPLOAD_EXPIRY_NEXT_SQL,
    /order by deadline, kind, id[\s\S]*limit 1/,
  )
})

test("unused tickets have a stable partial deadline index", () => {
  const index = getTableConfig(uploadTicket).indexes.find(
    (candidate) => candidate.config.name === "upload_ticket_unused_expiry_idx",
  )
  assert.ok(index)
  assert.deepEqual(
    index.config.columns.map((column) => {
      assert.ok("name" in column)
      return column.name
    }),
    ["expires_at", "id"],
  )
  assert.ok(index.config.where)
  assert.match(
    new PgDialect().sqlToQuery(index.config.where, "indexes").sql,
    /"used_at" is null/,
  )
})

test("contract-1 retains the retired upload job kind", () => {
  assert.equal(new Set<string>(JOB_KINDS).has("upload.cleanup"), true)
})

test("orphan ticket CAS repeats identity, UTC cutoff, and active-owner guards", () => {
  const query = new PgDialect().sqlToQuery(
    expiredOrphanUploadTicketPredicate(
      ticketCandidate.id,
      ticketCandidate.targetId,
      ticketCandidate.scanCutoff,
    ),
    "indexes",
  ).sql
  assert.match(query, /"id" = \$1/)
  assert.match(query, /"target_type" = \$2/)
  assert.match(query, /"target_id" = \$3/)
  assert.match(query, /"used_at" is null/)
  assert.match(
    query,
    /"expires_at" <= \(cast\(\$4 as timestamptz\) at time zone 'UTC'\)/,
  )
  assert.match(
    query,
    /not exists \([\s\S]*owner\.status in \('pending', 'processing'\)/,
  )
})

test("initiation wakes only after successful atomic database work", async () => {
  const events: string[] = []
  const committed = await commitUploadInitiateAndWake(
    async () => {
      events.push("commit")
      return { ok: true as const }
    },
    () => events.push("wake"),
  )
  assert.equal(committed.ok, true)
  assert.deepEqual(events, ["commit", "wake"])

  await commitUploadInitiateAndWake(
    async () => ({ ok: false as const }),
    () => events.push("no-op-wake"),
  )
  await assert.rejects(
    commitUploadInitiateAndWake(
      async () => {
        throw new Error("transaction failed")
      },
      () => events.push("failed-wake"),
    ),
  )
  assert.deepEqual(events, ["commit", "wake"])
})

test("an idle coordinator runs at the exact future deadline", async () => {
  const reached = deferred<void>()
  let scans = 0
  const worker = coordinator({
    async selectDueCandidates() {
      scans += 1
      if (scans === 2) reached.resolve()
      return []
    },
    async selectNextExpiry() {
      return scans === 1 ? new Date(Date.now() + 20) : null
    },
    async processCandidate() {
      assert.fail("no candidate is due")
    },
  })

  worker.start()
  await reached.promise
  assert.equal(scans, 2)
  await worker.stop()
})

test("a wake racing an active scan is remembered", async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const repumped = deferred<void>()
  let scans = 0
  const worker = coordinator({
    async selectDueCandidates() {
      scans += 1
      if (scans === 1) {
        entered.resolve()
        await release.promise
      } else {
        repumped.resolve()
      }
      return []
    },
    async selectNextExpiry() {
      return new Date(Date.now() + 60_000)
    },
    async processCandidate() {
      assert.fail("no candidate is due")
    },
  })

  worker.start()
  await entered.promise
  worker.wake()
  release.resolve()
  await repumped.promise
  assert.equal(scans, 2)
  await worker.stop()
})

test("one poison row is cooled while unrelated due work advances", async () => {
  const goodProcessed = deferred<void>()
  const excludedScan = deferred<void>()
  const poisonRetried = deferred<void>()
  let poisonAttempts = 0
  let poisonAvailable = true
  let goodAvailable = true
  const observedExclusions: UploadExpiryExclusions[] = []
  const worker = coordinator(
    {
      async selectDueCandidates(_limit, exclusions) {
        observedExclusions.push(exclusions)
        if (exclusions.clipIds.includes(clipCandidate.id)) {
          excludedScan.resolve()
        }
        const rows: UploadExpiryCandidate[] = []
        if (poisonAvailable && !exclusions.clipIds.includes(clipCandidate.id)) {
          rows.push(clipCandidate)
        }
        if (
          goodAvailable &&
          !exclusions.ticketIds.includes(ticketCandidate.id)
        ) {
          rows.push(ticketCandidate)
        }
        return rows
      },
      async selectNextExpiry() {
        return null
      },
      async processCandidate(row) {
        if (row.kind === "clip") {
          poisonAttempts += 1
          if (poisonAttempts === 1) throw new Error("storage unavailable")
          poisonAvailable = false
          poisonRetried.resolve()
          return
        }
        goodAvailable = false
        goodProcessed.resolve()
      },
    },
    { candidateRetryMs: 20, onError: () => undefined },
  )

  worker.start()
  await goodProcessed.promise
  await excludedScan.promise
  assert.equal(poisonAttempts, 1)
  assert.ok(
    observedExclusions.some((entry) =>
      entry.clipIds.includes(clipCandidate.id),
    ),
  )
  await poisonRetried.promise
  assert.equal(poisonAttempts, 2)
  await worker.stop()
})

test("expired poison cooldowns stay excluded until the due tail advances", async () => {
  const tailProcessed = deferred<void>()
  const rows = Array.from({ length: 6 }, (_, index) =>
    candidate(
      "clip",
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
  )
  const tail = rows.at(-1)!
  let tailAvailable = true
  const worker = coordinator(
    {
      async selectDueCandidates(limit, exclusions) {
        return rows
          .filter(
            (row) =>
              (row.id !== tail.id || tailAvailable) &&
              !exclusions.clipIds.includes(row.id),
          )
          .slice(0, limit)
      },
      async selectNextExpiry() {
        return null
      },
      async processCandidate(row) {
        if (row.id === tail.id) {
          tailAvailable = false
          tailProcessed.resolve()
          return
        }
        // Longer than the retry delay: pruning cooldowns per batch would keep
        // recycling the earliest poison rows and never reach the tail.
        await new Promise((resolve) => setTimeout(resolve, 3))
        throw new Error("persistent poison")
      },
    },
    { candidateRetryMs: 1, onError: () => undefined },
  )

  worker.start()
  await tailProcessed.promise
  await worker.stop()
})

test("coordinator faults use the short retry", async () => {
  const recovered = deferred<void>()
  let scans = 0
  let errors = 0
  const worker = coordinator(
    {
      async selectDueCandidates() {
        scans += 1
        if (scans === 1) throw new Error("database unavailable")
        recovered.resolve()
        return []
      },
      async selectNextExpiry() {
        return null
      },
      async processCandidate() {
        assert.fail("no candidate is due")
      },
    },
    {
      errorRetryMs: 10,
      onError: () => {
        errors += 1
      },
    },
  )

  worker.start()
  await recovered.promise
  assert.equal(scans, 2)
  assert.equal(errors, 1)
  await worker.stop()
})

test("stop aborts and joins an in-flight candidate", async () => {
  const entered = deferred<void>()
  let aborted = false
  let offered = false
  const worker = coordinator({
    async selectDueCandidates() {
      if (offered) return []
      offered = true
      return [clipCandidate]
    },
    async selectNextExpiry() {
      return null
    },
    async processCandidate(_row, signal) {
      entered.resolve()
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true
            resolve()
          },
          { once: true },
        )
      })
    },
  })

  worker.start()
  await entered.promise
  await worker.stop()
  assert.equal(aborted, true)
})

function candidate(
  kind: UploadExpiryCandidate["kind"],
  id: string,
): UploadExpiryCandidate {
  return {
    kind,
    id,
    targetId: "33333333-3333-4333-8333-333333333333",
    deadline: new Date("2026-01-01T00:00:00.000Z"),
    scanCutoff: new Date("2026-01-01T00:00:01.000Z"),
  }
}

function coordinator(
  store: UploadExpiryStore,
  overrides: {
    candidateRetryMs?: number
    errorRetryMs?: number
    onError?: (cause: unknown) => void
  } = {},
): UploadExpiryCoordinator {
  return new UploadExpiryCoordinator({
    store,
    batchSize: 2,
    candidateRetryMs: overrides.candidateRetryMs,
    errorRetryMs: overrides.errorRetryMs,
    reconciliationIntervalMs: 60_000,
    onError: overrides.onError ?? ((cause) => assert.fail(String(cause))),
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
