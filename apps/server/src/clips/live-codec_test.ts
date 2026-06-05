import type {
  AdminEncoderCapabilities,
  EncoderCodec,
} from "@workspace/contracts"

import type { HwaccelKind } from "../config/store"
import {
  parseRequestedLiveCodecs,
  selectLiveCodecFromCapabilities,
} from "./live-codec"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function capabilities(
  hwaccel: HwaccelKind,
  codecs: readonly EncoderCodec[],
): AdminEncoderCapabilities {
  const empty = { h264: false, hevc: false, av1: false }
  return {
    ffmpegOk: true,
    ffmpegVersion: "ffmpeg test",
    available: {
      none: { ...empty },
      amf: { ...empty },
      nvenc: { ...empty },
      qsv: { ...empty },
      rkmpp: { ...empty },
      vaapi: { ...empty },
      videotoolbox: { ...empty },
      v4l2m2m: { ...empty },
      [hwaccel]: {
        h264: codecs.includes("h264"),
        hevc: codecs.includes("hevc"),
        av1: codecs.includes("av1"),
      },
    },
  }
}

Deno.test("parseRequestedLiveCodecs keeps old clients on H.264", () => {
  const parsed = parseRequestedLiveCodecs(undefined)

  assert(!parsed.explicitlyRequested, "missing query should be implicit")
  assert(parsed.codecs.length === 1, "missing query should request one codec")
  assert(parsed.codecs[0] === "h264", "missing query should request H.264")
})

Deno.test("parseRequestedLiveCodecs ignores unknown codecs", () => {
  const parsed = parseRequestedLiveCodecs("hevc, vp9, av1, none")

  assert(parsed.explicitlyRequested, "query should be explicit")
  assert(parsed.codecs.join(",") === "hevc,av1", "unknown codecs are ignored")
})

Deno.test("parseRequestedLiveCodecs preserves explicit empty codec support", () => {
  const parsed = parseRequestedLiveCodecs("none")

  assert(parsed.explicitlyRequested, "query should be explicit")
  assert(parsed.codecs.length === 0, "codecs=none should request no codecs")
})

Deno.test("selectLiveCodecFromCapabilities fails when ffmpeg is unavailable", () => {
  const caps = capabilities("none", ["h264", "hevc", "av1"])
  caps.ffmpegOk = false

  const selected = selectLiveCodecFromCapabilities("none", ["h264"], caps)

  assert(selected === null, "unavailable ffmpeg should fail live selection")
})

Deno.test("selectLiveCodecFromCapabilities uses AV1, HEVC, H.264 priority", () => {
  const selected = selectLiveCodecFromCapabilities(
    "nvenc",
    ["h264", "av1", "hevc"],
    capabilities("nvenc", ["h264", "hevc", "av1"]),
  )

  assert(selected?.codec === "av1", "AV1 should win when available")
  assert(
    selected.encoder === "av1_nvenc",
    "selected encoder should match backend",
  )
})

Deno.test("selectLiveCodecFromCapabilities does not fall back to another backend", () => {
  const caps = capabilities("qsv", ["h264"])
  caps.available.none.av1 = true
  caps.available.none.hevc = true

  const selected = selectLiveCodecFromCapabilities("qsv", ["av1", "hevc"], caps)

  assert(selected === null, "missing configured-backend codecs should fail")
})

Deno.test("selectLiveCodecFromCapabilities returns lower priority configured codec", () => {
  const selected = selectLiveCodecFromCapabilities(
    "vaapi",
    ["av1", "hevc", "h264"],
    capabilities("vaapi", ["h264"]),
  )

  assert(
    selected?.codec === "h264",
    "H.264 should be used when it is the best match",
  )
  assert(
    selected.encoder === "h264_vaapi",
    "encoder should use configured backend",
  )
})
