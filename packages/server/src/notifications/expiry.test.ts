import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { insertNotificationAndWake, mutateNotificationsAndWake } from "./expiry"

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
