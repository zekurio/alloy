import assert from "node:assert/strict"
import test from "node:test"

import {
  createExpiryWorker,
  type ExpiryStore,
} from "@alloy/server/runtime/wakeable-serial-worker"

import {
  AUTH_CHALLENGE_EXPIRY_DELETE_SQL,
  AUTH_CHALLENGE_EXPIRY_NEXT_SQL,
  insertAuthChallengeAndWake,
} from "./challenge-expiry"

test("timestamp-without-time-zone expiry is compared and returned as UTC", () => {
  assert.match(
    AUTH_CHALLENGE_EXPIRY_DELETE_SQL,
    /expires_at <= \(now\(\) at time zone 'UTC'\)/,
  )
  assert.match(
    AUTH_CHALLENGE_EXPIRY_NEXT_SQL,
    /min\(expires_at\) at time zone 'UTC'/,
  )
})

test("startup drains bounded full batches before scheduling a deadline", async () => {
  const idle = deferred<void>()
  const deleted = [2, 2, 1]
  let deleteCalls = 0
  let deadlineCalls = 0
  const worker = coordinator(
    {
      async deleteExpiredBatch(limit) {
        assert.equal(limit, 2)
        deleteCalls += 1
        return deleted.shift() ?? 0
      },
      async selectNextExpiry() {
        deadlineCalls += 1
        idle.resolve()
        return null
      },
    },
    { batchSize: 2 },
  )

  worker.start()
  await idle.promise
  assert.equal(deleteCalls, 3)
  assert.equal(deadlineCalls, 1)
  await worker.stop()
})

test("an idle coordinator runs at the indexed future deadline", async () => {
  const reachedDeadline = deferred<void>()
  let deleteCalls = 0
  const worker = coordinator({
    async deleteExpiredBatch() {
      deleteCalls += 1
      if (deleteCalls === 2) reachedDeadline.resolve()
      return 0
    },
    async selectNextExpiry() {
      return deleteCalls === 1 ? new Date(Date.now() + 20) : null
    },
  })

  worker.start()
  await reachedDeadline.promise
  assert.equal(deleteCalls, 2)
  await worker.stop()
})

test("an empty expiry store is periodically reconciled", async () => {
  const reconciled = deferred<void>()
  let deleteCalls = 0
  const worker = coordinator(
    {
      async deleteExpiredBatch() {
        deleteCalls += 1
        if (deleteCalls === 2) reconciled.resolve()
        return 0
      },
      async selectNextExpiry() {
        return null
      },
    },
    { reconciliationIntervalMs: 15 },
  )

  worker.start()
  await reconciled.promise
  assert.equal(deleteCalls, 2)
  await worker.stop()
})

test("a wake preempts a later deadline", async () => {
  const firstIdle = deferred<void>()
  const delivered = deferred<void>()
  let available = false
  let deleteCalls = 0
  const worker = coordinator({
    async deleteExpiredBatch() {
      deleteCalls += 1
      if (available) {
        available = false
        delivered.resolve()
        return 1
      }
      return 0
    },
    async selectNextExpiry() {
      firstIdle.resolve()
      return new Date(Date.now() + 60_000)
    },
  })

  worker.start()
  await firstIdle.promise
  available = true
  worker.wake()
  await delivered.promise
  assert.equal(deleteCalls, 2)
  await worker.stop()
})

test("a wake racing an active drain schedules an immediate second pass", async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const repumped = deferred<void>()
  let deleteCalls = 0
  const worker = coordinator({
    async deleteExpiredBatch() {
      deleteCalls += 1
      if (deleteCalls === 1) {
        entered.resolve()
        await release.promise
      } else {
        repumped.resolve()
      }
      return 0
    },
    async selectNextExpiry() {
      return new Date(Date.now() + 60_000)
    },
  })

  worker.start()
  await entered.promise
  worker.wake()
  release.resolve()
  await repumped.promise
  assert.equal(deleteCalls, 2)
  await worker.stop()
})

test("database faults use the short retry instead of reconciliation", async () => {
  const retried = deferred<void>()
  let calls = 0
  let errors = 0
  const worker = coordinator(
    {
      async deleteExpiredBatch() {
        calls += 1
        if (calls === 1) throw new Error("database unavailable")
        retried.resolve()
        return 0
      },
      async selectNextExpiry() {
        return null
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
  await retried.promise
  assert.equal(calls, 2)
  assert.equal(errors, 1)
  await worker.stop()
})

test("stop aborts and joins an in-flight expiry pass", async () => {
  const entered = deferred<void>()
  let aborted = false
  const worker = coordinator({
    async deleteExpiredBatch(_limit, signal) {
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
      return 0
    },
    async selectNextExpiry() {
      assert.fail("an aborted pass must not query another deadline")
    },
  })

  worker.start()
  await entered.promise
  await worker.stop()
  assert.equal(aborted, true)
})

test("producer wake runs only after a successful insert", async () => {
  let wakes = 0
  const inserted = await insertAuthChallengeAndWake(
    async () => "challenge-id",
    () => {
      wakes += 1
    },
  )
  assert.equal(inserted, "challenge-id")
  assert.equal(wakes, 1)

  await assert.rejects(
    insertAuthChallengeAndWake(
      async () => {
        throw new Error("insert failed")
      },
      () => {
        wakes += 1
      },
    ),
  )
  assert.equal(wakes, 1)
})

function coordinator(
  store: ExpiryStore,
  overrides: {
    batchSize?: number
    reconciliationIntervalMs?: number
    errorRetryMs?: number
    onError?: (cause: unknown) => void
  } = {},
) {
  return createExpiryWorker({
    store,
    batchSize: overrides.batchSize ?? 500,
    errorRetryMs: overrides.errorRetryMs,
    reconciliationIntervalMs: overrides.reconciliationIntervalMs ?? 60_000,
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
