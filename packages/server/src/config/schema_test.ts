import { test } from "node:test"

import { RuntimeConfigSchema } from "./schema"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

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
