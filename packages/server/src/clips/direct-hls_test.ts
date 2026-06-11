import { test } from "node:test"

import {
  directHlsContentType,
  isServableDirectHlsFile,
  makeDirectHlsSpec,
} from "./direct-hls-spec"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("direct HLS filenames accept the mediabunny output layout", () => {
  for (const name of [
    "master.m3u8",
    "playlist-1.m3u8",
    "playlist-12.m3u8",
    "init-1.mp4",
    "init-2.m4s",
    "segment-1-1.m4s",
    "segment-2-37.mp4",
  ]) {
    assert(isServableDirectHlsFile(name), `${name} should be servable`)
  }
})

test("direct HLS filenames reject traversal and staged files", () => {
  for (const name of [
    "source",
    ".complete",
    "../master.m3u8",
    "..\\master.m3u8",
    "master.m3u8/..",
    "segment-1-1.ts",
    "playlist-x.m3u8",
    "segment--1-1.m4s",
    "init-1.mp4.bak",
    "",
  ]) {
    assert(!isServableDirectHlsFile(name), `${name} should be rejected`)
  }
})

test("direct HLS content types map playlists and media", () => {
  assert(
    directHlsContentType("master.m3u8") === "application/vnd.apple.mpegurl",
    "playlists are m3u8",
  )
  assert(
    directHlsContentType("segment-1-1.m4s") === "video/mp4",
    "segments are mp4",
  )
})

test("direct HLS cache keys change when the source changes", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    sourceKey: "aa/bb/clip/source",
    sourceSizeBytes: 1000,
    updatedAt: "2026-06-11T00:00:00.000Z",
  }
  const a = makeDirectHlsSpec(base)
  const sameInputs = makeDirectHlsSpec({ ...base })
  const newSource = makeDirectHlsSpec({
    ...base,
    sourceKey: "aa/bb/clip/source-x1",
  })
  const newVersion = makeDirectHlsSpec({
    ...base,
    updatedAt: "2026-06-12T00:00:00.000Z",
  })

  assert(a.cacheKey === sameInputs.cacheKey, "keys must be deterministic")
  assert(/^[0-9a-f]{32}$/.test(a.cacheKey), "keys are 32 hex chars")
  assert(a.cacheKey !== newSource.cacheKey, "source key participates")
  assert(a.cacheKey !== newVersion.cacheKey, "updatedAt participates")
})
