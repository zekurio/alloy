import assert from "node:assert/strict"
import test from "node:test"

import { gameSlugWithId, steamGridDbIdFromGameSlug } from "./slug"

test("game slugs append and parse the SteamGridDB id", () => {
  const slug = gameSlugWithId("Portal 2", 620)

  assert.equal(slug, "portal-2-620")
  assert.equal(steamGridDbIdFromGameSlug(slug), 620)
})

test("game slugs fall back when a title has no slug-safe characters", () => {
  const slug = gameSlugWithId("!!!", 42)

  assert.equal(slug, "game-42")
  assert.equal(steamGridDbIdFromGameSlug(slug), 42)
})

test("game slugs trim separators after truncating the title", () => {
  const slug = gameSlugWithId(`${"a".repeat(47)} b`, 123)

  assert.equal(slug, `${"a".repeat(47)}-123`)
  assert.equal(steamGridDbIdFromGameSlug(slug), 123)
})

test("game slug parser rejects missing, zero, and unsafe ids", () => {
  assert.equal(steamGridDbIdFromGameSlug("portal"), null)
  assert.equal(steamGridDbIdFromGameSlug("portal-0"), null)
  assert.equal(steamGridDbIdFromGameSlug("portal-9007199254740992"), null)
})
