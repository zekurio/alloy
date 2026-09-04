import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { evaluateClipAccess, type ClipViewer } from "./access-policy"

const AUTHOR_ID = "7b9c1ab1-a6cf-4619-b732-cf780e253f46"
const OTHER_ID = "515292d7-e05e-4104-a8f5-e14f73ff512b"

function viewer(
  id: string,
  role: "admin" | "user",
  status: "active" | "disabled",
): ClipViewer {
  return { id, role, status }
}

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
  const viewers = [
    viewer(AUTHOR_ID, "user", "active"),
    viewer(OTHER_ID, "admin", "active"),
  ]

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
