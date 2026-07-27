import assert from "node:assert/strict"
import { test } from "node:test"

import { clipIdFromPath, clipIdFromPermalink } from "./permalink"

const ORIGIN = "https://clips.example.com"
const CLIP = "562f5a6b-5a85-4fe0-a43f-14e0f232e683"

test("both permalink forms resolve to the clip id", () => {
  assert.equal(clipIdFromPath(`/clips/${CLIP}`), CLIP)
  assert.equal(clipIdFromPath(`/games/valorant/clips/${CLIP}`), CLIP)
  assert.equal(clipIdFromPath(`/clips/${CLIP}/`), CLIP)
})

test("unrelated paths resolve to nothing", () => {
  assert.equal(clipIdFromPath("/"), null)
  assert.equal(clipIdFromPath("/clips"), null)
  assert.equal(clipIdFromPath(`/clips/${CLIP}/edit`), null)
  assert.equal(clipIdFromPath(`/u/zekurio`), null)
})

test("a full permalink on our origin resolves", () => {
  assert.equal(clipIdFromPermalink(`${ORIGIN}/clips/${CLIP}`, ORIGIN), CLIP)
  assert.equal(
    clipIdFromPermalink(`${ORIGIN}/games/valorant/clips/${CLIP}`, ORIGIN),
    CLIP,
  )
})

test("a foreign origin never resolves to one of our clips", () => {
  // The url comes from an untrusted oEmbed caller. Without the origin check,
  // an attacker could have us describe our own clip under their domain.
  assert.equal(
    clipIdFromPermalink(`https://evil.example/clips/${CLIP}`, ORIGIN),
    null,
  )
  assert.equal(
    clipIdFromPermalink(
      `https://clips.example.com.evil.test/clips/${CLIP}`,
      ORIGIN,
    ),
    null,
  )
})

test("malformed urls resolve to nothing", () => {
  assert.equal(clipIdFromPermalink("", ORIGIN), null)
  assert.equal(clipIdFromPermalink("not a url", ORIGIN), null)
  assert.equal(clipIdFromPermalink("javascript:alert(1)", ORIGIN), null)
})
