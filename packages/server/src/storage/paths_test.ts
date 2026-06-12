import assert from "node:assert/strict"
import { test } from "node:test"

import { configuredFilesystemStoragePath, objectStoragePrefix } from "./paths"

test("configuredFilesystemStoragePath selects the namespace root", () => {
  const fs = {
    clipsPath: "hdd/clips",
    usersPath: "ssd/users",
  }

  assert.equal(configuredFilesystemStoragePath(fs, "clips"), "hdd/clips")
  assert.equal(configuredFilesystemStoragePath(fs, "users"), "ssd/users")
})

test("objectStoragePrefix uses stable S3 namespace prefixes", () => {
  assert.equal(objectStoragePrefix("clips"), "clips")
  assert.equal(objectStoragePrefix("users"), "users")
})
