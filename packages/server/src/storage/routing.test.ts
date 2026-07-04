import assert from "node:assert/strict"
import { test } from "node:test"

import {
  runScopedCutKey,
  runScopedRenditionKey,
  runScopedSourceKey,
  runScopedThumbKey,
} from "@alloy/server/queue/media-asset-keys"
import { stagedSourceKey } from "@alloy/server/uploads/staged"

import {
  clipAssetKey,
  clipStorage,
  clipStorageForKey,
  clipThumbnailStorage,
} from "./index"

const clipId = "11111111-2222-4333-8444-555555555555"
const runId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

test("clip asset keys route to their configured storage drivers", () => {
  assert.equal(
    clipStorageForKey(clipAssetKey(clipId, "thumb")),
    clipThumbnailStorage,
  )
  assert.equal(
    clipStorageForKey(clipAssetKey(clipId, "thumb-small")),
    clipThumbnailStorage,
  )
  assert.equal(
    clipStorageForKey(clipAssetKey(clipId, "scrubber")),
    clipThumbnailStorage,
  )
  assert.equal(clipStorageForKey(clipAssetKey(clipId, "source")), clipStorage)
})

test("run-scoped media asset keys route to their configured storage drivers", () => {
  assert.equal(
    clipStorageForKey(runScopedThumbKey(clipId, runId)),
    clipThumbnailStorage,
  )
  assert.equal(
    clipStorageForKey(runScopedSourceKey(clipId, runId)),
    clipStorage,
  )
  assert.equal(clipStorageForKey(runScopedCutKey(clipId, runId)), clipStorage)
  assert.equal(
    clipStorageForKey(runScopedRenditionKey(clipId, runId, "1080p60")),
    clipStorage,
  )
})

test("staged source upload keys route to clip storage", () => {
  assert.equal(
    clipStorageForKey(stagedSourceKey(clipId, "video/mp4")),
    clipStorage,
  )
})
