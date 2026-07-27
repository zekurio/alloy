import assert from "node:assert/strict"
import { test } from "node:test"

import {
  clipAccentColor,
  clipEmbedDescription,
  formatStatCount,
} from "./embed-text"

test("description carries the game then all three counts", () => {
  assert.equal(
    clipEmbedDescription({
      gameName: "Valorant",
      viewCount: 1_234,
      likeCount: 34,
      commentCount: 5,
    }),
    "Valorant · 👁 1.2K · ❤️ 34 · 💬 5",
  )
})

test("zero counts are still rendered", () => {
  // A fresh clip keeps the same layout as a popular one; dropping empty counts
  // would make the description shift shape as a clip gains engagement.
  assert.equal(
    clipEmbedDescription({
      gameName: "Valorant",
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
    }),
    "Valorant · 👁 0 · ❤️ 0 · 💬 0",
  )
})

test("formatStatCount truncates rather than rounding up", () => {
  assert.equal(formatStatCount(0), "0")
  assert.equal(formatStatCount(999), "999")
  assert.equal(formatStatCount(1_000), "1K")
  assert.equal(formatStatCount(1_299), "1.2K")
  assert.equal(formatStatCount(45_300), "45.3K")
  assert.equal(formatStatCount(2_100_000), "2.1M")
  assert.equal(formatStatCount(3_000_000_000), "3B")
})

test("accent colour is a hex triple", () => {
  assert.match(clipAccentColor("Valorant"), /^#[0-9a-f]{6}$/)
  assert.match(clipAccentColor(null), /^#[0-9a-f]{6}$/)
})

test("accent colour is stable per game and differs between games", () => {
  assert.equal(clipAccentColor("Valorant"), clipAccentColor("Valorant"))
  assert.notEqual(
    clipAccentColor("Valorant"),
    clipAccentColor("Counter-Strike 2"),
  )
})
