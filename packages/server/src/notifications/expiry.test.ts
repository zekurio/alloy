import assert from "node:assert/strict"
import test from "node:test"

import { notification } from "@alloy/db/schema"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"

import {
  insertNotificationAndWake,
  mutateNotificationsAndWake,
  NOTIFICATION_EXPIRY_DELETE_SQL,
  NOTIFICATION_EXPIRY_NEXT_SQL,
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
