import assert from "node:assert/strict"
import test from "node:test"

import { FsStorageDriver } from "./fs-driver"

function driver(root: string): FsStorageDriver {
  return new FsStorageDriver({
    root,
    publicBaseUrl: "http://localhost:3000",
    hmacSecret: "test-secret",
  })
}

test("FsStorageDriver resolves keys under Windows drive roots", () => {
  const storage = driver("C:\\Users\\zekurio\\Git\\alloy\\data\\clips")

  assert.equal(
    storage.fullPath("ae/86/clip-id/source"),
    "C:/Users/zekurio/Git/alloy/data/clips/ae/86/clip-id/source",
  )
})

test("FsStorageDriver rejects absolute and escaping storage keys", () => {
  const storage = driver("C:\\Users\\zekurio\\Git\\alloy\\data\\clips")

  assert.throws(() => storage.fullPath("../config.json"))
  assert.throws(() => storage.fullPath("C:\\Windows\\system32"))
  assert.throws(() => storage.fullPath("/etc/passwd"))
})
