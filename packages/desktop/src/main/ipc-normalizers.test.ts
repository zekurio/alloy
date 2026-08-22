import assert from "node:assert/strict"
import test from "node:test"

import { isCurrentDesktopBridge } from "@alloy/contracts"

import { normalizeLibraryMetaPatch } from "./ipc-normalizers"

test("accepts bridge v2 and v3", () => {
  assert.equal(isCurrentDesktopBridge(1), false)
  assert.equal(isCurrentDesktopBridge(2), true)
  assert.equal(isCurrentDesktopBridge(3), true)
  assert.equal(isCurrentDesktopBridge(4), false)
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
