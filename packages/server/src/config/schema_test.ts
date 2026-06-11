import { test } from "node:test"

import { RuntimeConfigSchema } from "./schema"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("RuntimeConfigSchema defaults scheduled task overrides empty", () => {
  const parsed = RuntimeConfigSchema.parse({ runtimeConfigVersion: 1 })

  assert(
    Object.keys(parsed.scheduledTasks).length === 0,
    "scheduled task overrides should default empty",
  )
})

test("RuntimeConfigSchema accepts scheduled task cron triggers", () => {
  const parsed = RuntimeConfigSchema.parse({
    runtimeConfigVersion: 1,
    scheduledTasks: {
      "sample-maintenance": [
        { type: "startup", delayMs: 60_000 },
        { type: "cron", expression: "0 3 * * *" },
      ],
    },
  })

  assert(
    parsed.scheduledTasks["sample-maintenance"]?.[1]?.type === "cron",
    "cron trigger should parse",
  )
  assert(
    parsed.scheduledTasks["sample-maintenance"]?.[0]?.type === "startup",
    "startup trigger should parse",
  )
  assert(
    parsed.scheduledTasks["sample-maintenance"]?.[0]?.delayMs === 60_000,
    "startup delay should parse",
  )
})

test("RuntimeConfigSchema defaults storage to filesystem canonical folders", () => {
  const parsed = RuntimeConfigSchema.parse({ runtimeConfigVersion: 1 })

  assert(parsed.storage.driver === "fs", "storage driver should default to fs")
  assert(parsed.storage.path === "storage", "storage path should default")
  assert(parsed.storage.clipsPath === null, "clips path should default null")
  assert(parsed.storage.usersPath === null, "users path should default null")
})

test("RuntimeConfigSchema rejects storage paths with parent traversal", () => {
  const parsed = RuntimeConfigSchema.safeParse({
    runtimeConfigVersion: 1,
    storage: {
      driver: "fs",
      path: "../storage",
    },
  })

  assert(!parsed.success, "parent traversal should not parse")
})

test("RuntimeConfigSchema rejects invalid scheduled task cron triggers", () => {
  const parsed = RuntimeConfigSchema.safeParse({
    runtimeConfigVersion: 1,
    scheduledTasks: {
      "sample-maintenance": [{ type: "cron", expression: "0 0 0 0" }],
    },
  })

  assert(!parsed.success, "invalid cron should not parse")
})
