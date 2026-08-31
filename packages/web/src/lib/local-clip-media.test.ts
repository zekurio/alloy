import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { localClipIsFinalCut } from "./local-clip-media"

const clip = {
  id: "clip-1",
  durationMs: 10_000,
  sourceDurationMs: 60_000,
  trimStartMs: 20_000,
  trimEndMs: 30_000,
}

test("uses only local files that already contain the final published cut", () => {
  assert.equal(
    localClipIsFinalCut(
      {
        uploadedClipId: clip.id,
        uploadedClipSourceStartMs: 0,
        uploadedClipSourceDurationMs: 60_000,
        durationMs: 60_000,
      },
      clip,
    ),
    false,
  )
  assert.equal(
    localClipIsFinalCut(
      {
        uploadedClipId: clip.id,
        uploadedClipSourceStartMs: null,
        uploadedClipSourceDurationMs: null,
        durationMs: 10_050,
      },
      clip,
    ),
    true,
  )
})
