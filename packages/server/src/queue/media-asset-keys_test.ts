import assert from "node:assert/strict"
import test from "node:test"

import { clipAssetDir } from "@alloy/server/storage/driver"

import { runScopedSourceKey, runScopedThumbKey } from "./media-asset-keys"

const clipId = "aabbccdd-1111-2222-3333-444455556666"
const runId = "12345678-90ab-cdef-1234-567890abcdef"

test("run-scoped media asset keys are deterministic", () => {
  assert.equal(
    runScopedSourceKey(clipId, runId),
    runScopedSourceKey(clipId, runId),
  )
  assert.equal(
    runScopedThumbKey(clipId, runId),
    runScopedThumbKey(clipId, runId),
  )
})

test("run-scoped media asset keys differ across runs", () => {
  const otherRunId = "fedcba09-8765-4321-fedc-ba0987654321"

  assert.notEqual(
    runScopedSourceKey(clipId, runId),
    runScopedSourceKey(clipId, otherRunId),
  )
  assert.notEqual(
    runScopedThumbKey(clipId, runId),
    runScopedThumbKey(clipId, otherRunId),
  )
})

test("run-scoped media asset keys live under the clip asset directory", () => {
  const assetDir = clipAssetDir(clipId)

  assert.equal(
    runScopedSourceKey(clipId, runId).startsWith(`${assetDir}/`),
    true,
  )
  assert.equal(
    runScopedThumbKey(clipId, runId).startsWith(`${assetDir}/`),
    true,
  )
  assert.equal(runScopedThumbKey(clipId, runId).endsWith(".webp"), true)
})

test("run-scoped media asset key stamps strip UUID dashes", () => {
  const sourceStamp = runScopedSourceKey(clipId, runId).split("/source-").at(-1)
  const thumbStamp = runScopedThumbKey(clipId, runId)
    .split("/thumb-")
    .at(-1)
    ?.replace(/\.webp$/, "")

  assert.equal(sourceStamp?.includes("-"), false)
  assert.equal(thumbStamp?.includes("-"), false)
})
