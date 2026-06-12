import { test } from "node:test"

import { RuntimeConfigSchema } from "./schema"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("RuntimeConfigSchema defaults storage to filesystem roots", () => {
  const parsed = RuntimeConfigSchema.parse({ runtimeConfigVersion: 1 })

  assert(parsed.storage.driver === "fs", "storage driver should default to fs")
  assert(
    parsed.storage.fs.clipsPath === "storage/clips",
    "clips path should default",
  )
  assert(
    parsed.storage.fs.usersPath === "storage/users",
    "users path should default",
  )
})

test("RuntimeConfigSchema rejects storage paths with parent traversal", () => {
  const parsed = RuntimeConfigSchema.safeParse({
    runtimeConfigVersion: 1,
    storage: {
      driver: "fs",
      fs: {
        clipsPath: "../storage/clips",
        usersPath: "storage/users",
      },
    },
  })

  assert(!parsed.success, "parent traversal should not parse")
})

test("RuntimeConfigSchema migrates legacy storage paths", () => {
  const parsed = RuntimeConfigSchema.parse({
    runtimeConfigVersion: 1,
    storage: {
      driver: "fs",
      path: "media",
      clipsPath: "hdd/clips",
      usersPath: null,
    },
  })

  assert(
    parsed.storage.fs.clipsPath === "hdd/clips",
    "clips override should migrate",
  )
  assert(
    parsed.storage.fs.usersPath === "media/users",
    "users path should migrate from legacy root",
  )
})
