import assert from "node:assert/strict"
import { test } from "node:test"

import { DISPLAY_NAME_MAX_LENGTH, userDisplayLabel } from "@alloy/contracts"

import { normalizeDisplayName } from "./username"

test("normalizeDisplayName trims and keeps the value", () => {
  assert.equal(normalizeDisplayName("  Michael  "), "Michael")
})

test("normalizeDisplayName stores null for an empty value", () => {
  // Clearing the field is sending "" — it must not persist a blank string that
  // every reader would then have to special-case.
  assert.equal(normalizeDisplayName(""), null)
  assert.equal(normalizeDisplayName("   "), null)
})

test("normalizeDisplayName allows spaces, unicode and punctuation", () => {
  assert.equal(normalizeDisplayName("Michael S."), "Michael S.")
  assert.equal(normalizeDisplayName("ゼクリオ"), "ゼクリオ")
  assert.equal(normalizeDisplayName("🎮 zek"), "🎮 zek")
})

test("normalizeDisplayName rejects control characters", () => {
  assert.throws(() => normalizeDisplayName("two\nlines"), /control characters/)
  assert.throws(() => normalizeDisplayName("tab\there"), /control characters/)
})

test("normalizeDisplayName enforces the length cap", () => {
  const atLimit = "a".repeat(DISPLAY_NAME_MAX_LENGTH)
  assert.equal(normalizeDisplayName(atLimit), atLimit)
  assert.throws(
    () => normalizeDisplayName("a".repeat(DISPLAY_NAME_MAX_LENGTH + 1)),
    /at most/,
  )
})

test("userDisplayLabel prefers the display name and falls back to the handle", () => {
  assert.equal(
    userDisplayLabel({ username: "zekurio", displayName: "Michael" }),
    "Michael",
  )
  assert.equal(
    userDisplayLabel({ username: "zekurio", displayName: null }),
    "zekurio",
  )
  assert.equal(
    userDisplayLabel({ username: "zekurio", displayName: "  " }),
    "zekurio",
  )
  assert.equal(userDisplayLabel({ username: "zekurio" }), "zekurio")
})
