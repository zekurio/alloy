import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { visibilityFeedbackIntent } from "./library-clip-visibility"

test("keeps visibility feedback tied to the action after an optimistic update", () => {
  assert.equal(visibilityFeedbackIntent("public", "post", true), "post")
  assert.equal(visibilityFeedbackIntent("unlisted", "unpost", true), "unpost")
})
