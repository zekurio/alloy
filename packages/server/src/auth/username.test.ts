import assert from "node:assert/strict"
import test from "node:test"

import { normalizeUsername, slugifyUsername } from "./username"

test("normalizes stored usernames without a cosmetic @ prefix", () => {
  assert.equal(normalizeUsername("  Player_One  "), "Player_One")
  assert.throws(() => normalizeUsername("@player"), /cannot contain/)
  assert.throws(() => normalizeUsername("player one"), /cannot contain/)
})

test("generates URL-safe username hints while display names remain freeform", () => {
  assert.equal(slugifyUsername("Armin Ronacher ⇌"), "armin-ronacher")
  assert.equal(slugifyUsername("Jöhn_Doe"), "john_doe")
})
