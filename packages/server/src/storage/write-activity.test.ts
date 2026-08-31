import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import {
  storageObjectWriteIsActive,
  withStorageObjectWriteActivity,
} from "./write-activity"

test("storage writes are live across async IO and case aliases", async () => {
  const release = deferred<void>()
  const writing = withStorageObjectWriteActivity(
    "assets",
    "AA/bb/avatar.webp",
    async () => {
      assert.equal(
        storageObjectWriteIsActive("assets", "aa/BB/AVATAR.WEBP"),
        true,
      )
      await release.promise
    },
  )
  await nextTurn()
  assert.equal(storageObjectWriteIsActive("assets", "aa/bb/avatar.webp"), true)
  release.resolve()
  await writing
  assert.equal(storageObjectWriteIsActive("assets", "aa/bb/avatar.webp"), false)
})

test("a throwing write always releases its live fence", async () => {
  await assert.rejects(
    withStorageObjectWriteActivity("assets", "key", async () => {
      throw new Error("write failed")
    }),
  )
  assert.equal(storageObjectWriteIsActive("assets", "key"), false)
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
