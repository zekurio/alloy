import { test } from "node:test"

import { clipHlsMasterUrl, clipStreamUrl } from "./clips"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("clipStreamUrl carries the requested variant", () => {
  const url = clipStreamUrl("clip-id", "source")

  assert(url === "/api/clips/clip-id/stream?variant=source", "unexpected URL")
})

test("clipStreamUrl omits the variant when unset", () => {
  const url = clipStreamUrl("clip-id")

  assert(url === "/api/clips/clip-id/stream", "unexpected URL")
})

test("clipHlsMasterUrl points at the packaged master playlist", () => {
  const url = clipHlsMasterUrl("clip-id")

  assert(url === "/api/clips/clip-id/hls/master.m3u8", "unexpected URL")
})
