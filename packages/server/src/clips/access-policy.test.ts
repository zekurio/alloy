import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { evaluateClipAccess, type ClipViewer } from "./access-policy"

const AUTHOR_ID = "7b9c1ab1-a6cf-4619-b732-cf780e253f46"
const OTHER_ID = "515292d7-e05e-4104-a8f5-e14f73ff512b"

function viewer(
  id: string,
  role: "admin" | "user",
  status: "active" | "disabled" = "active",
): ClipViewer {
  return { id, role, status }
}

function access(privacy: string, currentViewer: ClipViewer) {
  return evaluateClipAccess({
    authorDisabledAt: null,
    authorId: AUTHOR_ID,
    policy: "engagement",
    privacy,
    status: "ready",
    viewer: currentViewer,
  }).accessible
}

test("private clips reject a former viewer but remain visible to active owners and admins", () => {
  assert.equal(access("private", viewer(OTHER_ID, "user")), false)
  assert.equal(access("private", viewer(AUTHOR_ID, "user")), true)
  assert.equal(access("private", viewer(OTHER_ID, "admin")), true)
})

test("public and unlisted clips remain visible to ordinary viewers", () => {
  assert.equal(access("public", viewer(OTHER_ID, "user")), true)
  assert.equal(access("unlisted", viewer(OTHER_ID, "user")), true)
  assert.equal(access("unlisted", null), true)
})

test("engagement access still requires a ready clip", () => {
  const decision = evaluateClipAccess({
    authorDisabledAt: null,
    authorId: AUTHOR_ID,
    policy: "engagement",
    privacy: "private",
    status: "processing",
    viewer: viewer(AUTHOR_ID, "user"),
  })

  assert.equal(decision.accessible, false)
})

test("inactive owners and administrators have no direct clip authority", () => {
  const viewers = [
    viewer(AUTHOR_ID, "user", "disabled"),
    viewer(OTHER_ID, "admin", "disabled"),
  ]

  for (const inactiveViewer of viewers) {
    assert.deepEqual(
      evaluateClipAccess({
        authorDisabledAt: null,
        authorId: AUTHOR_ID,
        policy: "metadata",
        privacy: "private",
        status: "ready",
        viewer: inactiveViewer,
      }),
      { accessible: false, error: "Not found", status: 404 },
    )
    assert.deepEqual(
      evaluateClipAccess({
        authorDisabledAt: null,
        authorId: AUTHOR_ID,
        policy: "metadata",
        privacy: "public",
        status: "processing",
        viewer: inactiveViewer,
      }),
      { accessible: false, error: "Not found", status: 404 },
    )
  }
})

test("inactive users retain anonymous access to ready shareable clips", () => {
  for (const privacy of ["public", "unlisted"]) {
    assert.deepEqual(
      evaluateClipAccess({
        authorDisabledAt: null,
        authorId: AUTHOR_ID,
        policy: "metadata",
        privacy,
        status: "ready",
        viewer: viewer(AUTHOR_ID, "admin", "disabled"),
      }),
      { accessible: true, isOwner: false, isAdmin: false },
    )
  }
})

test("active owners and administrators retain direct clip authority", () => {
  const viewers = [viewer(AUTHOR_ID, "user"), viewer(OTHER_ID, "admin")]

  for (const activeViewer of viewers) {
    assert.equal(
      evaluateClipAccess({
        authorDisabledAt: null,
        authorId: AUTHOR_ID,
        policy: "metadata",
        privacy: "private",
        status: "processing",
        viewer: activeViewer,
      }).accessible,
      true,
    )
  }
})
