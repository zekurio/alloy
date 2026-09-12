import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { parseClipListCursor } from "./clips-helpers"
import { encodeCursorPayload } from "./cursor-codec"

test("clip cursors require the publication timestamp and matching sort", () => {
  const publishedAt = "2026-09-12T09:00:00.000Z"
  const payload = { v: 1, sort: "recent", id: "clip-id", publishedAt }
  assert.deepEqual(
    parseClipListCursor(encodeCursorPayload(payload), "recent"),
    {
      publishedAt: new Date(publishedAt),
      id: "clip-id",
      viewCount: null,
    },
  )
  assert.equal(parseClipListCursor(encodeCursorPayload(payload), "top"), null)
  assert.equal(
    parseClipListCursor(
      encodeCursorPayload({
        v: 1,
        sort: "recent",
        id: "clip-id",
        createdAt: publishedAt,
      }),
      "recent",
    ),
    null,
  )
})
