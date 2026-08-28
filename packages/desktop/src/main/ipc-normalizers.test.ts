import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeLibraryDownloadRequest,
  normalizeLibraryMetaPatch,
} from "./ipc-normalizers"

test("accepts only canonical clip-download identity and metadata", () => {
  const clipId = "123e4567-e89b-42d3-a456-426614174000"
  assert.deepEqual(
    normalizeLibraryDownloadRequest({ clipId, title: "Example" }),
    {
      clipId,
      title: "Example",
      sizeBytes: null,
      durationMs: null,
      width: null,
      height: null,
      gameName: null,
    },
  )
  const attemptedTarget = normalizeLibraryDownloadRequest({
    clipId,
    title: "Example",
    mediaUrl: "https://attacker.example/endless",
  })
  assert.deepEqual(attemptedTarget, {
    clipId,
    title: "Example",
    sizeBytes: null,
    durationMs: null,
    width: null,
    height: null,
    gameName: null,
  })
  assert.equal(Object.hasOwn(attemptedTarget ?? {}, "mediaUrl"), false)
  assert.equal(
    normalizeLibraryDownloadRequest({ clipId: "../../admin", title: "Bad" }),
    null,
  )
})

test("normalizes a clip link and its source mapping together", () => {
  assert.deepEqual(
    normalizeLibraryMetaPatch({
      id: "capture",
      uploadedClipId: "clip",
      uploadedClipSourceStartMs: 125.4,
      uploadedClipSourceDurationMs: 9_999.6,
    }),
    {
      id: "capture",
      uploadedClipId: "clip",
      uploadedClipSourceStartMs: 125,
      uploadedClipSourceDurationMs: 10_000,
    },
  )
  assert.deepEqual(
    normalizeLibraryMetaPatch({
      id: "capture",
      uploadedClipId: "clip",
      uploadedClipSourceStartMs: null,
      uploadedClipSourceDurationMs: null,
    }),
    {
      id: "capture",
      uploadedClipId: "clip",
      uploadedClipSourceStartMs: null,
      uploadedClipSourceDurationMs: null,
    },
  )
})
