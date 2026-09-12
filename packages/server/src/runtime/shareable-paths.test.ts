import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { isShareableClipRequest } from "./shareable-paths"

test("shared clip access does not bypass browse authentication for other routes", () => {
  const clip = "/api/clips/30000000-0000-4000-8000-000000000001"
  assert.equal(isShareableClipRequest("GET", clip), true)
  assert.equal(isShareableClipRequest("HEAD", `${clip}/thumbnail`), true)
  assert.equal(isShareableClipRequest("POST", `${clip}/view`), true)
  for (const path of [
    `${clip}/comments`,
    "/api/feed",
    "/api/users",
    "/api/admin/users",
    "/api/notifications",
  ]) {
    assert.equal(isShareableClipRequest("GET", path), false, path)
  }
  assert.equal(isShareableClipRequest("DELETE", clip), false)
})
