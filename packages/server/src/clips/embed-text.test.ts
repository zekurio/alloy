import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { clipEmbedDescription } from "./embed-text"

test("clip embeds use fully-qualified Discord emoji sequences", () => {
  assert.equal(
    clipEmbedDescription({
      gameName: "Valorant",
      viewCount: 1_234,
    }),
    "Valorant · 👁️ 1.2K",
  )
})
