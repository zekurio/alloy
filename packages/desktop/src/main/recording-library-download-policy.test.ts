import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import {
  clipDownloadByteLimit,
  MAX_CLIP_DOWNLOAD_BYTES,
  selectedServerClipDownloadUrl,
} from "./recording-library-download-policy"

const CLIP_ID = "123e4567-e89b-42d3-a456-426614174000"

test("derives one canonical selected-server clip download URL", () => {
  assert.equal(
    selectedServerClipDownloadUrl(CLIP_ID, "https://alloy.example/other"),
    `https://alloy.example/api/clips/${CLIP_ID}/download`,
  )
  assert.equal(
    selectedServerClipDownloadUrl("../../events", "https://alloy.example"),
    null,
  )
  assert.equal(
    selectedServerClipDownloadUrl(CLIP_ID, "http://192.168.1.10:2552"),
    null,
  )
})

test("caps declared and chunked clip downloads", () => {
  assert.equal(clipDownloadByteLimit(null), MAX_CLIP_DOWNLOAD_BYTES)
  assert.equal(clipDownloadByteLimit(100), 1024 * 1024 + 100)
  assert.throws(
    () => clipDownloadByteLimit(MAX_CLIP_DOWNLOAD_BYTES + 1),
    /download limit/,
  )
})
