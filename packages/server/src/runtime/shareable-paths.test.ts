import assert from "node:assert/strict"
import { test } from "node:test"

import { isShareableClipRequest } from "./shareable-paths"

const CLIP = "0b7d3f2a-1c44-4e8b-9f10-2ab5c6d7e8f9"

test("clip poster and stream stay reachable anonymously", () => {
  assert.equal(isShareableClipRequest("GET", `/api/clips/${CLIP}/stream`), true)
  assert.equal(
    isShareableClipRequest("GET", `/api/clips/${CLIP}/thumbnail`),
    true,
  )
})

test("embedded video files are reachable anonymously", () => {
  // The head advertises these as og:video / media_attachments. Before they were
  // allowlisted, a default instance (requireAuthToBrowse on) served Discord a
  // 401 and the embed rendered with a dead player.
  assert.equal(
    isShareableClipRequest("GET", `/api/clips/${CLIP}/source/file`),
    true,
  )
  for (const name of ["720p", "1080p60", "1080p-hevc"]) {
    assert.equal(
      isShareableClipRequest(
        "GET",
        `/api/clips/${CLIP}/rendition/${name}/file.mp4`,
      ),
      true,
      name,
    )
  }
})

test("the oEmbed document is reachable anonymously", () => {
  // Discord fetches this for the embed's author line; a 401 here silently
  // costs the author line without otherwise breaking the embed.
  assert.equal(isShareableClipRequest("GET", "/api/oembed"), true)
  assert.equal(isShareableClipRequest("HEAD", "/api/oembed"), true)
  assert.equal(isShareableClipRequest("POST", "/api/oembed"), false)
})

test("HEAD and GET differ per surface", () => {
  assert.equal(isShareableClipRequest("GET", `/api/clips/${CLIP}`), true)
  assert.equal(isShareableClipRequest("HEAD", `/api/clips/${CLIP}`), false)
  assert.equal(isShareableClipRequest("POST", `/api/clips/${CLIP}/view`), true)
  assert.equal(isShareableClipRequest("GET", `/api/clips/${CLIP}/view`), false)
})

test("mutations and unrelated paths are never shareable", () => {
  assert.equal(
    isShareableClipRequest("DELETE", `/api/clips/${CLIP}/source/file`),
    false,
  )
  assert.equal(isShareableClipRequest("GET", "/api/clips"), false)
  assert.equal(isShareableClipRequest("GET", "/api/users/me"), false)
  assert.equal(
    isShareableClipRequest("GET", `/api/clips/${CLIP}/renditions`),
    false,
  )
})

test("path traversal in a rendition name is rejected", () => {
  assert.equal(
    isShareableClipRequest(
      "GET",
      `/api/clips/${CLIP}/rendition/../../secret/file.mp4`,
    ),
    false,
  )
})
