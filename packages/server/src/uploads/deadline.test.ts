import assert from "node:assert/strict"
import test from "node:test"

import { clip } from "@alloy/db/schema"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"

import {
  decodeUploadToken,
  mintFsUploadTicket,
  uploadTokenIsExpired,
} from "../storage/fs-upload-token"
import {
  runPendingUploadCleanup,
  type RecoverableUploadTicket,
  withPendingUploadCleanupStopped,
} from "./cleanup"
import {
  LEGACY_UPLOAD_DEADLINE_REPAIR_SQL,
  completedUploadDeadline,
  completedUploadMatches,
  completedUploadPersistenceSatisfied,
  pendingUploadFinalizationAction,
  pendingUploadCleanupStillDue,
  repairLegacyUploadDeadlines,
  uploadTicketCanAcceptBytes,
  uploadTicketCanFinalize,
  uploadTicketDeadline,
} from "./deadline"
import { selectPreferredUploadTicket } from "./tickets"

test("minted token expiry is the exact initial persisted deadline", () => {
  assert.equal(
    uploadTicketDeadline(1_800_000_123).toISOString(),
    "2027-01-15T08:02:03.000Z",
  )
})

test("completed bytes receive a full new upload grace period", () => {
  const completedAt = new Date("2026-08-31T12:00:00.250Z")
  assert.equal(
    completedUploadDeadline(completedAt, 3_600).toISOString(),
    "2026-08-31T13:00:00.250Z",
  )
})

test("unused and completed tickets use their respective strict grace", () => {
  const now = new Date("2026-08-31T12:00:00.000Z")
  const before = new Date(now.getTime() - 1)
  const after = new Date(now.getTime() + 1)

  assert.equal(
    uploadTicketCanFinalize({ expiresAt: after, usedAt: null }, null, now),
    true,
  )
  assert.equal(
    uploadTicketCanFinalize({ expiresAt: now, usedAt: null }, after, now),
    false,
  )
  assert.equal(
    uploadTicketCanFinalize({ expiresAt: before, usedAt: before }, after, now),
    true,
  )
  assert.equal(
    uploadTicketCanFinalize({ expiresAt: before, usedAt: before }, now, now),
    false,
  )
})

test("signed upload tokens expire at the equality boundary", () => {
  assert.equal(uploadTokenIsExpired(100, 99), false)
  assert.equal(uploadTokenIsExpired(100, 100), true)
  assert.equal(uploadTokenIsExpired(100, 101), true)
})

test("a verified expired token retains payload only for terminal recovery", async () => {
  const ticket = await mintFsUploadTicket({
    payload: {
      k: "uploads/clip/attempt/source.mp4",
      ct: "video/mp4",
      mb: 100,
      exp: 1,
      uid: "user-id",
      cid: "clip-id",
      m: "single",
    },
    publicBaseUrl: "https://alloy.test",
    secret: "test-secret",
  })
  const token = ticket.uploadUrl.split("/").at(-1)
  assert.ok(token)
  const decoded = await decodeUploadToken(token, "test-secret")
  assert.equal(decoded.ok, true)
  if (!decoded.ok) assert.fail("signed token should verify")
  assert.equal(decoded.expired, true)
  assert.equal(decoded.payload.k, "uploads/clip/attempt/source.mp4")
})

test("non-exact terminals may write only while token and DB ticket are live", () => {
  const now = new Date("2026-08-31T12:00:00.000Z")
  const live = {
    expiresAt: new Date(now.getTime() + 1),
    usedAt: null,
  }
  assert.equal(uploadTicketCanAcceptBytes(live, false, now), true)
  assert.equal(uploadTicketCanAcceptBytes(live, true, now), false)
  assert.equal(
    uploadTicketCanAcceptBytes({ expiresAt: now, usedAt: null }, false, now),
    false,
  )
  assert.equal(
    uploadTicketCanAcceptBytes(
      { expiresAt: live.expiresAt, usedAt: now },
      false,
      now,
    ),
    false,
  )
})

test("only exact completed objects are adopted without rewriting", () => {
  const expected = { bytes: 10_000, contentType: "video/mp4" }
  assert.equal(
    completedUploadMatches(
      { size: 10_000, contentType: "video/mp4" },
      expected,
    ),
    true,
  )
  // A crash-partial single upload must consume the retry body instead.
  assert.equal(
    completedUploadMatches({ size: 9_999, contentType: "video/mp4" }, expected),
    false,
  )
  assert.equal(
    completedUploadMatches(
      { size: 10_000, contentType: "application/octet-stream" },
      expected,
    ),
    false,
  )
})

test("a duplicate terminal request accepts another request's durable adoption", () => {
  const usedAt = new Date("2026-08-31T12:00:00.000Z")
  assert.equal(completedUploadPersistenceSatisfied(true, null), true)
  assert.equal(completedUploadPersistenceSatisfied(false, { usedAt }), true)
  assert.equal(
    completedUploadPersistenceSatisfied(false, { usedAt: null }),
    false,
  )
  assert.equal(completedUploadPersistenceSatisfied(false, null), false)
})

test("finalize recovers exact unused bytes but never re-extends used grace", () => {
  const now = new Date("2026-08-31T12:00:00.000Z")
  const expired = new Date(now.getTime() - 1)
  const exact = { size: 10_000, contentType: "video/mp4" }
  const ticket = {
    expectedBytes: 10_000,
    contentType: "video/mp4",
    expiresAt: expired,
    usedAt: null,
  }

  assert.equal(
    pendingUploadFinalizationAction(ticket, exact, expired, now),
    "recover",
  )
  assert.equal(
    pendingUploadFinalizationAction(
      { ...ticket, usedAt: expired },
      exact,
      expired,
      now,
    ),
    "expired",
  )
  assert.equal(
    pendingUploadFinalizationAction(
      ticket,
      { ...exact, size: exact.size - 1 },
      expired,
      now,
    ),
    "expired",
  )
})

test("legacy duplicate selection matches the repaired maximum deadline", () => {
  const createdAt = new Date("2026-08-31T10:00:00.000Z")
  const tickets = [
    {
      id: "00000000-0000-0000-0000-000000000001",
      storageKey: "uploads/clip/old/source.mp4",
      contentType: "video/mp4",
      expectedBytes: 10_000,
      expiresAt: new Date("2026-08-31T11:00:00.000Z"),
      usedAt: null,
      createdAt,
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      storageKey: "uploads/clip/winner/source.mp4",
      contentType: "video/mp4",
      expectedBytes: 10_000,
      expiresAt: new Date("2026-08-31T10:30:00.000Z"),
      usedAt: new Date("2026-08-31T11:30:00.000Z"),
      createdAt,
    },
  ]

  assert.equal(
    selectPreferredUploadTicket(tickets, 3_600)?.storageKey,
    "uploads/clip/winner/source.mp4",
  )
  assert.equal(
    selectPreferredUploadTicket(tickets.toReversed(), 3_600)?.storageKey,
    "uploads/clip/winner/source.mp4",
  )
})

test("cleanup recheck rejects a completed upload's extended deadline", () => {
  const selected = new Date("2026-08-31T12:00:00.000Z")
  const extended = new Date("2026-08-31T13:00:00.000Z")
  assert.equal(
    pendingUploadCleanupStillDue({
      selectedDeadline: selected,
      currentDeadline: selected,
      dueAtLock: true,
    }),
    true,
  )
  assert.equal(
    pendingUploadCleanupStillDue({
      selectedDeadline: selected,
      currentDeadline: extended,
      dueAtLock: true,
    }),
    false,
  )
  assert.equal(
    pendingUploadCleanupStillDue({
      selectedDeadline: selected,
      currentDeadline: selected,
      dueAtLock: false,
    }),
    false,
  )
  assert.equal(
    pendingUploadCleanupStillDue({
      selectedDeadline: selected,
      currentDeadline: null,
      dueAtLock: true,
    }),
    false,
  )
})

test("cleanup adopts exact committed bytes before deleting a pending clip", async () => {
  const events: string[] = []
  const ticket = recoverableTicket()
  const result = await runPendingUploadCleanup({
    async recheck() {
      events.push("recheck")
      return true
    },
    async selectUnusedTickets() {
      events.push("tickets")
      return [ticket]
    },
    async resolve() {
      events.push("resolve")
      return { size: ticket.expectedBytes, contentType: ticket.contentType }
    },
    async adopt() {
      events.push("adopt")
      return true
    },
    async remove() {
      assert.fail("an adopted upload must not be deleted")
    },
  })

  assert.equal(result, "adopted")
  assert.deepEqual(events, ["recheck", "tickets", "resolve", "adopt"])
})

test("cleanup deletes only after every unused ticket lacks exact bytes", async () => {
  const ticket = recoverableTicket()
  let removed = 0
  const result = await runPendingUploadCleanup({
    async recheck() {
      return true
    },
    async selectUnusedTickets() {
      return [ticket]
    },
    async resolve() {
      return { size: ticket.expectedBytes - 1, contentType: ticket.contentType }
    },
    async adopt() {
      assert.fail("mismatched bytes must not be adopted")
    },
    async remove() {
      removed += 1
      return true
    },
  })

  assert.equal(result, "deleted")
  assert.equal(removed, 1)
})

test("cleanup fails safe when storage recovery inspection fails", async () => {
  const ticket = recoverableTicket()
  let removed = 0
  await assert.rejects(
    runPendingUploadCleanup({
      async recheck() {
        return true
      },
      async selectUnusedTickets() {
        return [ticket]
      },
      async resolve() {
        throw new Error("storage unavailable")
      },
      async adopt() {
        assert.fail("failed inspection cannot be adopted")
      },
      async remove() {
        removed += 1
        return true
      },
    }),
    /storage unavailable/,
  )
  assert.equal(removed, 0)
})

test("an adoption CAS loss skips stale deletion", async () => {
  const ticket = recoverableTicket()
  let removed = 0
  const result = await runPendingUploadCleanup({
    async recheck() {
      return true
    },
    async selectUnusedTickets() {
      return [ticket]
    },
    async resolve() {
      return { size: ticket.expectedBytes, contentType: ticket.contentType }
    },
    async adopt() {
      return false
    },
    async remove() {
      removed += 1
      return true
    },
  })

  assert.equal(result, "changed")
  assert.equal(removed, 0)
})

test("an expired used-ticket grace is deleted rather than re-extended", async () => {
  let adopted = 0
  let removed = 0
  const result = await runPendingUploadCleanup({
    async recheck() {
      return true
    },
    async selectUnusedTickets() {
      // Production applies used_at IS NULL, so a used ticket is absent here.
      return []
    },
    async resolve() {
      assert.fail("used tickets must not be inspected for recovery")
    },
    async adopt() {
      adopted += 1
      return true
    },
    async remove() {
      removed += 1
      return true
    },
  })

  assert.equal(result, "deleted")
  assert.equal(adopted, 0)
  assert.equal(removed, 1)
})

test("a changed deadline stops cleanup before storage inspection", async () => {
  let inspected = 0
  const result = await runPendingUploadCleanup({
    async recheck() {
      return false
    },
    async selectUnusedTickets() {
      inspected += 1
      return []
    },
    async resolve() {
      inspected += 1
      return null
    },
    async adopt() {
      inspected += 1
      return false
    },
    async remove() {
      inspected += 1
      return false
    },
  })

  assert.equal(result, "changed")
  assert.equal(inspected, 0)
})

test("cleanup ownership nests media-stop outside upload-stop", async () => {
  const events: string[] = []
  const result = await withPendingUploadCleanupStopped(
    "clip-id",
    async () => {
      events.push("operation")
      return 42
    },
    {
      async withMediaStopped(id, operation) {
        assert.equal(id, "clip-id")
        events.push("media-enter")
        const value = await operation()
        events.push("media-exit")
        return value
      },
      async withUploadStopped(id, operation) {
        assert.equal(id, "clip-id")
        events.push("upload-enter")
        const value = await operation()
        events.push("upload-exit")
        return value
      },
    },
  )

  assert.equal(result, 42)
  assert.deepEqual(events, [
    "media-enter",
    "upload-enter",
    "operation",
    "upload-exit",
    "media-exit",
  ])
})

test("legacy repair is bounded, UTC-normalized, and rechecks ownership", () => {
  assert.match(
    LEGACY_UPLOAD_DEADLINE_REPAIR_SQL,
    /where status = 'pending'[\s\S]*upload_cleanup_at is null[\s\S]*limit \$2/,
  )
  assert.match(
    LEGACY_UPLOAD_DEADLINE_REPAIR_SQL,
    /max\([\s\S]*greatest\([\s\S]*expires_at at time zone 'UTC'[\s\S]*used_at at time zone 'UTC'/,
  )
  assert.match(
    LEGACY_UPLOAD_DEADLINE_REPAIR_SQL,
    /created_at at time zone 'UTC'/,
  )
  assert.match(
    LEGACY_UPLOAD_DEADLINE_REPAIR_SQL,
    /date_trunc\('milliseconds', cleanup_at\)[\s\S]*interval '1 millisecond'/,
  )
  assert.match(
    LEGACY_UPLOAD_DEADLINE_REPAIR_SQL,
    /target_type = 'clip'[\s\S]*target_id = candidates.id/,
  )
  assert.match(
    LEGACY_UPLOAD_DEADLINE_REPAIR_SQL,
    /where clip.id = deadlines.id[\s\S]*clip.status = 'pending'[\s\S]*clip.upload_cleanup_at is null/,
  )
})

test("startup repair drains full bounded batches", async () => {
  const results = [2, 2, 1]
  const calls: Array<{ ttl: number; limit: number }> = []
  const repaired = await repairLegacyUploadDeadlines(3_600, {
    batchSize: 2,
    async repairBatch(ttl, limit) {
      calls.push({ ttl, limit })
      return results.shift() ?? 0
    },
  })

  assert.equal(repaired, 5)
  assert.deepEqual(calls, [
    { ttl: 3_600, limit: 2 },
    { ttl: 3_600, limit: 2 },
    { ttl: 3_600, limit: 2 },
  ])
})

test("pending cleanup uses a timezone-aware partial deadline index", () => {
  assert.equal(clip.upload_cleanup_at.getSQLType(), "timestamp with time zone")
  const index = getTableConfig(clip).indexes.find(
    (candidate) => candidate.config.name === "clip_pending_upload_cleanup_idx",
  )
  assert.ok(index)
  assert.deepEqual(indexColumnNames(index), ["upload_cleanup_at", "id"])
  assert.match(indexPredicate(index), /"status" = 'pending'/)
  assert.match(indexPredicate(index), /"upload_cleanup_at" is not null/)
})

function recoverableTicket(): RecoverableUploadTicket {
  return {
    id: "ticket-id",
    storageKey: "uploads/clip-id/attempt/source.mp4",
    contentType: "video/mp4",
    expectedBytes: 10_000,
  }
}

function indexColumnNames(
  index: ReturnType<typeof getTableConfig>["indexes"][number],
): string[] {
  return index.config.columns.map((column) => {
    assert.ok("name" in column)
    assert.ok(column.name)
    return column.name
  })
}

function indexPredicate(
  index: ReturnType<typeof getTableConfig>["indexes"][number],
): string {
  assert.ok(index.config.where)
  return new PgDialect().sqlToQuery(index.config.where, "indexes").sql
}
