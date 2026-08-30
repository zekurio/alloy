import assert from "node:assert/strict"
import test from "node:test"

import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"

import {
  storageDeletionRetryAt,
  validateStorageDeletionInput,
  validateStorageKey,
} from "./deletion-policy"
import {
  activeRunBlocksStorageDeletion,
  clipStorageKeyClipId,
  stableThumbnailClipId,
} from "./deletion-references"
import { runStorageDeletion } from "./deletion-run"
import type { StorageDriver } from "./driver"

test("storage deletion retries indefinitely with a bounded deadline", () => {
  const attemptedAt = new Date("2026-01-01T00:00:00.000Z")
  assert.equal(
    storageDeletionRetryAt(0, attemptedAt).toISOString(),
    "2026-01-01T00:00:05.000Z",
  )
  assert.equal(
    storageDeletionRetryAt(100, attemptedAt).toISOString(),
    "2026-01-01T01:00:00.000Z",
  )
})

test("coordinator faults use the short error retry instead of reconciliation", async () => {
  let calls = 0
  const recovered = deferred<void>()
  const worker = new WakeableSerialWorker({
    reconciliationIntervalMs: 60_000,
    errorRetryMs: 10,
    async runOne() {
      calls += 1
      if (calls === 1) throw new Error("database unavailable")
      recovered.resolve()
      return { worked: false, nextRunAt: null }
    },
    onError: () => undefined,
  })
  worker.start()
  await recovered.promise
  assert.equal(calls, 2)
  await worker.stop()
})

test("storage deletion identity rejects path aliases", () => {
  for (const key of ["", "/root", "a//b", "a/../b", "a\\b", "a?b"]) {
    assert.throws(() => validateStorageKey(key))
  }
  assert.doesNotThrow(() => validateStorageKey("aa/bb/object/source.mp4"))
  assert.doesNotThrow(() => validateStorageKey("AA/bb/object/source.mp4"))
})

test("enqueue metadata is normalized and abort defaults off", () => {
  assert.deepEqual(
    validateStorageDeletionInput({
      namespace: "clips",
      key: "uploads/recording/source.mp4",
      reason: "  expired upload  ",
      source: { type: " upload-ticket ", id: " ticket-id " },
    }),
    {
      namespace: "clips",
      key: "uploads/recording/source.mp4",
      abortUpload: false,
      reason: "expired upload",
      sourceType: "upload-ticket",
      sourceId: "ticket-id",
    },
  )
})

test("a live reference prevents both upload abort and object deletion", async () => {
  const calls: string[] = []
  const result = await runStorageDeletion(
    {
      namespace: "clips",
      key: "uploads/id/source.mp4",
      abortUpload: true,
      sourceType: "upload-ticket",
      sourceId: "ticket-id",
    },
    {
      storage: fakeStorage(calls),
      isWriteActive: () => false,
      hasLiveReference: async () => true,
      signal: new AbortController().signal,
    },
  )
  assert.equal(result, "referenced")
  assert.deepEqual(calls, [])
})

test("staged cleanup aborts upload state before deleting the object", async () => {
  const calls: string[] = []
  const result = await runStorageDeletion(
    {
      namespace: "clips",
      key: "uploads/id/source.mp4",
      abortUpload: true,
      sourceType: "upload-ticket",
      sourceId: "ticket-id",
    },
    {
      storage: fakeStorage(calls),
      isWriteActive: () => false,
      hasLiveReference: async () => false,
      signal: new AbortController().signal,
    },
  )
  assert.equal(result, "deleted")
  assert.deepEqual(calls, [
    "abort:uploads/id/source.mp4",
    "delete:uploads/id/source.mp4",
  ])
})

test("shutdown after upload abort leaves the durable object intent", async () => {
  const calls: string[] = []
  const controller = new AbortController()
  const storage = fakeStorage(calls, () => controller.abort())
  const result = await runStorageDeletion(
    {
      namespace: "clips",
      key: "uploads/id/source.mp4",
      abortUpload: true,
      sourceType: "upload-ticket",
      sourceId: "ticket-id",
    },
    {
      storage,
      isWriteActive: () => false,
      hasLiveReference: async () => false,
      signal: controller.signal,
    },
  )
  assert.equal(result, "interrupted")
  assert.deepEqual(calls, ["abort:uploads/id/source.mp4"])
})

test("an active object writer defers a prewrite intent before DB adoption", async () => {
  const calls: string[] = []
  const result = await runStorageDeletion(
    {
      namespace: "assets",
      key: "aa/bb/user/avatar-version.webp",
      abortUpload: false,
      sourceType: "storage-prewrite",
      sourceId: "attempt-id",
    },
    {
      storage: fakeStorage(calls),
      isWriteActive: () => true,
      hasLiveReference: async () => true,
      signal: new AbortController().signal,
    },
  )
  assert.equal(result, "referenced")
  assert.deepEqual(calls, [])
})

test("a DB-live prewrite reservation completes as an adopted object", async () => {
  const calls: string[] = []
  const result = await runStorageDeletion(
    {
      namespace: "assets",
      key: "aa/bb/user/avatar-version.webp",
      abortUpload: false,
      sourceType: "storage-prewrite",
      sourceId: "attempt-id",
    },
    {
      storage: fakeStorage(calls),
      isWriteActive: () => false,
      hasLiveReference: async () => true,
      signal: new AbortController().signal,
    },
  )
  assert.equal(result, "adopted")
  assert.deepEqual(calls, [])
})

test("legacy stable thumbnail ownership is parsed without prefix guesses", () => {
  const id = "11ebc58a-92f9-4f9d-b88c-3e89150b7d1e"
  assert.equal(stableThumbnailClipId(`11/eb/${id}/thumb.jpg`), id)
  assert.equal(stableThumbnailClipId(`11/eb/${id}/thumb-small.jpg`), id)
  assert.equal(stableThumbnailClipId(`22/eb/${id}/thumb.jpg`), null)
  assert.equal(stableThumbnailClipId(`prefix/11/eb/${id}/thumb.jpg`), null)
})

test("run-scoped objects are attributed only to their exact clip shard", () => {
  const id = "11ebc58a-92f9-4f9d-b88c-3e89150b7d1e"
  assert.equal(
    clipStorageKeyClipId(`11/eb/${id}/rendition-1080p-aabbcc.mp4`),
    id,
  )
  assert.equal(
    clipStorageKeyClipId(`22/eb/${id}/rendition-1080p-aabbcc.mp4`),
    null,
  )
  assert.equal(clipStorageKeyClipId(`11/eb/${id}/nested/file.mp4`), null)
})

test("a media run may retire its own unreferenced keys without active-run deferral", () => {
  const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  assert.equal(
    activeRunBlocksStorageDeletion(runId, {
      type: "media-run",
      id: runId.toUpperCase(),
    }),
    false,
  )
  assert.equal(
    activeRunBlocksStorageDeletion(runId, {
      type: "media-run",
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
    true,
  )
  assert.equal(
    activeRunBlocksStorageDeletion(runId, {
      type: "poster-request",
      id: runId,
    }),
    true,
  )
})

function fakeStorage(calls: string[], afterAbort?: () => void): StorageDriver {
  // SAFETY: runStorageDeletion exercises only abortUpload and delete; both are
  // supplied by this focused fake and no other driver method is reachable.
  return {
    async abortUpload({ key }) {
      calls.push(`abort:${key}`)
      afterAbort?.()
    },
    async delete(key) {
      calls.push(`delete:${key}`)
    },
  } as StorageDriver
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
