import assert from "node:assert/strict"
import test from "node:test"

import { notification } from "@alloy/db/schema"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"

import {
  NOTIFICATION_EXPIRY_DELETE_SQL,
  NOTIFICATION_EXPIRY_NEXT_SQL,
  NotificationExpiryCoordinator,
  type NotificationExpiryStore,
  insertNotificationAndWake,
  mutateNotificationsAndWake,
} from "./expiry"

test("retention SQL preserves creation-anchored read and unread TTLs", () => {
  assert.match(
    NOTIFICATION_EXPIRY_DELETE_SQL,
    /read_at is not null[\s\S]*created_at <= now\(\) - interval '30 days'/,
  )
  assert.match(
    NOTIFICATION_EXPIRY_DELETE_SQL,
    /read_at is null[\s\S]*created_at <= now\(\) - interval '90 days'/,
  )
  assert.equal(
    [...NOTIFICATION_EXPIRY_DELETE_SQL.matchAll(/limit \$1/g)].length,
    3,
  )
  assert.match(
    NOTIFICATION_EXPIRY_DELETE_SQL,
    /order by created_at, id[\s\S]*order by expires_at, id/,
  )

  assert.match(
    NOTIFICATION_EXPIRY_NEXT_SQL,
    /created_at \+ interval '30 days'[\s\S]*read_at is not null/,
  )
  assert.match(
    NOTIFICATION_EXPIRY_NEXT_SQL,
    /created_at \+ interval '90 days'[\s\S]*read_at is null/,
  )
  assert.match(NOTIFICATION_EXPIRY_NEXT_SQL, /select min\(expires_at\)/)
})

test("retention partitions have stable global deadline indexes", () => {
  const indexes = getTableConfig(notification).indexes
  const read = indexes.find(
    (candidate) => candidate.config.name === "notification_retention_read_idx",
  )
  const unread = indexes.find(
    (candidate) =>
      candidate.config.name === "notification_retention_unread_idx",
  )
  assert.ok(read)
  assert.ok(unread)

  assert.deepEqual(indexColumnNames(read), ["created_at", "id"])
  assert.deepEqual(indexColumnNames(unread), ["created_at", "id"])
  assert.match(indexPredicate(read), /"read_at" is not null/)
  assert.match(indexPredicate(unread), /"read_at" is null/)
})

test("startup drains bounded full batches before selecting a deadline", async () => {
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

test("an idle coordinator runs at the exact persisted deadline", async () => {
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

test("an empty store is periodically reconciled", async () => {
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

test("marking an old unread notification read wakes immediate expiry", async () => {
  const firstIdle = deferred<void>()
  const expired = deferred<void>()
  let becameRead = false
  let deleteCalls = 0
  const worker = coordinator({
    async deleteExpiredBatch() {
      deleteCalls += 1
      if (becameRead) {
        becameRead = false
        expired.resolve()
        return 1
      }
      return 0
    },
    async selectNextExpiry() {
      firstIdle.resolve()
      // The old unread row would otherwise remain for another month.
      return new Date(Date.now() + 60_000)
    },
  })

  worker.start()
  await firstIdle.promise
  await mutateNotificationsAndWake(
    async () => {
      becameRead = true
      return { rowCount: 1 }
    },
    () => worker.wake(),
  )
  await expired.promise
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

test("insert wakes only for a committed row and before later work", async () => {
  const events: string[] = []
  const row = await insertNotificationAndWake(
    async () => {
      events.push("insert")
      return { id: "notification-id" }
    },
    () => events.push("wake"),
  )
  events.push("hydrate")
  assert.deepEqual(row, { id: "notification-id" })
  assert.deepEqual(events, ["insert", "wake", "hydrate"])

  await insertNotificationAndWake(
    async () => null,
    () => events.push("conflict-wake"),
  )
  await assert.rejects(
    insertNotificationAndWake(
      async () => {
        throw new Error("insert failed")
      },
      () => events.push("failed-wake"),
    ),
  )
  assert.deepEqual(events, ["insert", "wake", "hydrate"])
})

test("read-state mutations wake only after database success", async () => {
  const events: string[] = []
  const result = await mutateNotificationsAndWake(
    async () => {
      events.push("mark-read")
      return { rowCount: 3 }
    },
    () => events.push("wake"),
  )
  assert.equal(result.rowCount, 3)
  assert.deepEqual(events, ["mark-read", "wake"])

  await mutateNotificationsAndWake(
    async () => ({ rowCount: 0 }),
    () => events.push("no-op-wake"),
  )

  await assert.rejects(
    mutateNotificationsAndWake(
      async () => {
        throw new Error("update failed")
      },
      () => events.push("failed-wake"),
    ),
  )
  assert.deepEqual(events, ["mark-read", "wake"])
})

function coordinator(
  store: NotificationExpiryStore,
  overrides: {
    batchSize?: number
    reconciliationIntervalMs?: number
    errorRetryMs?: number
    onError?: (cause: unknown) => void
  } = {},
): NotificationExpiryCoordinator {
  return new NotificationExpiryCoordinator({
    store,
    batchSize: overrides.batchSize,
    reconciliationIntervalMs: overrides.reconciliationIntervalMs ?? 60_000,
    errorRetryMs: overrides.errorRetryMs,
    onError: overrides.onError ?? ((cause) => assert.fail(String(cause))),
  })
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
