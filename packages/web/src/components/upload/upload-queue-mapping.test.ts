import assert from "node:assert/strict"

import type { QueueClip } from "@alloy/api"
import { test } from "vite-plus/test"

import { serverToQueueItem } from "./upload-queue-mapping"

const readyClip = {
  id: "018fdb4c-7d55-7ad8-9c18-3b8948ce6b55",
  title: "Clip",
  status: "ready",
  encodeActive: false,
  encodeProgress: 100,
  encodeStage: null,
  encodeTier: null,
  encodeTierIndex: null,
  encodeTierCount: null,
  failureReason: null,
  hasThumb: false,
  thumbVersion: null,
  thumbBlurHash: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  updatedAt: "2026-08-31T12:00:00.000Z",
  gameId: null,
  gameSlug: null,
} satisfies QueueClip

test("a ready clip reports background re-encoding without losing publication", () => {
  const item = serverToQueueItem(
    {
      ...readyClip,
      encodeActive: true,
      encodeProgress: 0,
    },
    {},
  )

  assert.equal(item.status, "uploading")
  assert.equal(item.phase, "processing")
  assert.equal(item.label, "Re-encoding")
  assert.equal(item.indeterminate, true)
})

test("a ready clip returns to published after replacement commits", () => {
  const item = serverToQueueItem(readyClip, {})

  assert.equal(item.status, "published")
  assert.equal(item.phase, "upload")
  assert.equal(item.progress, 100)
})
