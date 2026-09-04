import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { evaluateClipAccess, type ClipViewer } from "./access-policy"

const authorId = "11111111-1111-4111-8111-111111111111"
const otherId = "22222222-2222-4222-8222-222222222222"

function access(privacy: string, viewer: ClipViewer) {
  return evaluateClipAccess({
    authorDisabledAt: null,
    authorId,
    policy: "engagement",
    privacy,
    status: "ready",
    viewer,
  }).accessible
}

test("private clips reject a former viewer but remain visible to owners and admins", () => {
  assert.equal(access("private", { id: otherId, role: "user" }), false)
  assert.equal(access("private", { id: authorId, role: "user" }), true)
  assert.equal(access("private", { id: otherId, role: "admin" }), true)
})

test("public and unlisted clips remain visible to ordinary viewers", () => {
  assert.equal(access("public", { id: otherId, role: "user" }), true)
  assert.equal(access("unlisted", { id: otherId, role: "user" }), true)
  assert.equal(access("unlisted", null), true)
})

test("engagement access still requires a ready clip", () => {
  const decision = evaluateClipAccess({
    authorDisabledAt: null,
    authorId,
    policy: "engagement",
    privacy: "private",
    status: "processing",
    viewer: { id: authorId, role: "user" },
  })

  assert.equal(decision.accessible, false)
})
