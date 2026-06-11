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
      "clip-storage-cleanup": [
        { type: "startup", delayMs: 60_000 },
        { type: "cron", expression: "0 3 * * *" },
      ],
    },
  })

  assert(
    parsed.scheduledTasks["clip-storage-cleanup"]?.[1]?.type === "cron",
    "cron trigger should parse",
  )
  assert(
    parsed.scheduledTasks["clip-storage-cleanup"]?.[0]?.type === "startup",
    "startup trigger should parse",
  )
  assert(
    parsed.scheduledTasks["clip-storage-cleanup"]?.[0]?.delayMs === 60_000,
    "startup delay should parse",
  )
})

test("RuntimeConfigSchema rejects invalid scheduled task cron triggers", () => {
  const parsed = RuntimeConfigSchema.safeParse({
    runtimeConfigVersion: 1,
    scheduledTasks: {
      "clip-storage-cleanup": [{ type: "cron", expression: "0 0 0 0" }],
    },
  })

  assert(!parsed.success, "invalid cron should not parse")
})
