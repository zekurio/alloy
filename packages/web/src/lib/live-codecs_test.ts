import { test } from "node:test"

import { liveCodecsFromSupport } from "./live-codecs"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("liveCodecsFromSupport preserves AV1, HEVC, H.264 priority", () => {
  const codecs = liveCodecsFromSupport({
    canPlayType: (mimeType) =>
      mimeType.includes("av01") || mimeType.includes("avc1") ? "probably" : "",
    mediaSourceCanPlay: (mimeType) => mimeType.includes("hvc1"),
  })

  assert(
    codecs.join(",") === "av1,hevc,h264",
    "codec priority should be stable",
  )
})

test("liveCodecsFromSupport returns empty list when no probe matches", () => {
  const codecs = liveCodecsFromSupport({
    canPlayType: () => "",
    mediaSourceCanPlay: () => false,
  })

  assert(codecs.length === 0, "unsupported browser should return empty list")
})

test("liveCodecsFromSupport treats HEVC hvc1 and hev1 as equivalent support", () => {
  const codecs = liveCodecsFromSupport({
    canPlayType: (mimeType) => (mimeType.includes("hev1") ? "maybe" : ""),
  })

  assert(codecs.join(",") === "hevc", "hev1 should enable HEVC live codec")
})
