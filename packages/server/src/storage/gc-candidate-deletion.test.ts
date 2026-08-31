import assert from "node:assert/strict"
import test from "node:test"

import type { StorageDriver } from "./driver"
import { deleteStorageGcCandidate } from "./gc-candidate-deletion"

test("storage GC protects an object with an active writer", async () => {
  const calls: string[] = []
  assert.equal(await run(calls, { writeActive: true }), "protected")
  assert.deepEqual(calls, ["classify"])
})

test("storage GC protects an object with an authoritative live reference", async () => {
  const calls: string[] = []
  assert.equal(
    await run(calls, { namespace: "thumbnails", liveReference: true }),
    "protected",
  )
  assert.deepEqual(calls, [
    "classify",
    "reference:thumbnails:key:storage-gc:null",
  ])
})

test("storage GC leaves a candidate whose classification changed", async () => {
  const calls: string[] = []
  assert.equal(await run(calls, { classified: false }), "reclassified")
  assert.deepEqual(calls, ["classify"])
})

test("storage GC observes interruption before physical deletion", async () => {
  const calls: string[] = []
  const controller = new AbortController()
  assert.equal(
    await run(calls, { controller, abortAfterReference: true }),
    "interrupted",
  )
  assert.deepEqual(calls, ["classify", "reference:clips:key:storage-gc:null"])
})

test("storage GC deletes a revalidated, unreferenced idle object", async () => {
  const calls: string[] = []
  assert.equal(await run(calls), "deleted")
  assert.deepEqual(calls, [
    "classify",
    "reference:clips:key:storage-gc:null",
    "delete:key",
  ])
})

async function run(
  calls: string[],
  options: {
    writeActive?: boolean
    liveReference?: boolean
    classified?: boolean
    namespace?: "clips" | "thumbnails"
    controller?: AbortController
    abortAfterReference?: boolean
  } = {},
) {
  const controller = options.controller ?? new AbortController()
  return deleteStorageGcCandidate(options.namespace ?? "clips", "key", {
    // SAFETY: deleteStorageGcCandidate exercises only StorageDriver.delete;
    // every other member is deliberately unreachable in this unit test.
    storage: {
      async delete(key) {
        calls.push(`delete:${key}`)
      },
    } as StorageDriver,
    async classifyCurrent() {
      calls.push("classify")
      return options.classified ?? true
    },
    isWriteActive: () => options.writeActive ?? false,
    async hasLiveReference(namespace, key, source) {
      calls.push(`reference:${namespace}:${key}:${source.type}:${source.id}`)
      if (options.abortAfterReference) controller.abort()
      return options.liveReference ?? false
    },
    signal: controller.signal,
  })
}
