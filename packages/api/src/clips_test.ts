import { test } from "node:test"

import { clipStreamUrl } from "./clips"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function query(url: string): URLSearchParams {
  return new URL(url, "https://alloy.test").searchParams
}

test("clipStreamUrl omits live codec query when support is unknown", () => {
  const url = clipStreamUrl("clip-id", "source")

  assert(url === "/api/clips/clip-id/stream?variant=source", "unexpected URL")
  assert(!query(url).has("codecs"), "codec query should be omitted")
})

test("clipStreamUrl sends browser live codec support in priority order", () => {
  const url = clipStreamUrl("clip-id", "720p", undefined, [
    "av1",
    "hevc",
    "h264",
  ])

  assert(
    query(url).get("codecs") === "av1,hevc,h264",
    "codec query should preserve browser priority",
  )
})

test("clipStreamUrl sends codecs=none for explicit empty browser support", () => {
  const url = clipStreamUrl("clip-id", "720p", undefined, [])

  assert(
    query(url).get("codecs") === "none",
    "empty browser support should stay explicit",
  )
})
