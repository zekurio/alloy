import assert from "node:assert/strict"
import test from "node:test"

import { sameClipSourceIncarnation } from "./media-deletion-policy"

test("same-author UUID reuse is fenced by its versioned source key", () => {
  const original = {
    authorId: "author",
    sourceKey: "11/eb/id/source-original",
  }
  assert.equal(sameClipSourceIncarnation(original, { ...original }), true)
  assert.equal(
    sameClipSourceIncarnation(original, {
      authorId: "author",
      sourceKey: "11/eb/id/source-recreated",
    }),
    false,
  )
})
