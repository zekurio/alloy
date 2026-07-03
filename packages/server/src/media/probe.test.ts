import assert from "node:assert/strict"
import { test } from "node:test"

import { buildAudioCodecString, buildVideoCodecString } from "./probe"

test("buildVideoCodecString derives avc1 strings from profile and level", () => {
  assert.equal(
    buildVideoCodecString({
      codec_name: "h264",
      codec_tag_string: "avc1",
      profile: "High",
      level: 41,
    }),
    "avc1.640029",
  )
  assert.equal(
    buildVideoCodecString({
      codec_name: "h264",
      codec_tag_string: "avc1",
      profile: "Main",
      level: 31,
    }),
    "avc1.4D001F",
  )
  assert.equal(
    buildVideoCodecString({
      codec_name: "h264",
      codec_tag_string: "avc1",
      profile: "Constrained Baseline",
      level: 30,
    }),
    "avc1.42001E",
  )
})

test("buildVideoCodecString signals hvc1 for hevc renditions", () => {
  assert.equal(
    buildVideoCodecString({
      codec_name: "hevc",
      codec_tag_string: "hvc1",
      profile: "Main",
      level: 153,
    }),
    "hvc1.1.6.L153.B0",
  )
})

test("buildVideoCodecString derives av01 with bit depth from pix_fmt", () => {
  assert.equal(
    buildVideoCodecString({
      codec_name: "av1",
      codec_tag_string: "av01",
      level: 13,
      pix_fmt: "yuv420p",
    }),
    "av01.0.13M.08",
  )
  assert.equal(
    buildVideoCodecString({
      codec_name: "av1",
      codec_tag_string: "av01",
      level: 8,
      pix_fmt: "yuv420p10le",
    }),
    "av01.0.08M.10",
  )
})

test("buildVideoCodecString returns null without enough decoder config", () => {
  assert.equal(
    buildVideoCodecString({
      codec_name: "h264",
      codec_tag_string: "avc1",
      profile: "High",
    }),
    null,
  )
  assert.equal(
    buildVideoCodecString({
      codec_name: "vp9",
      codec_tag_string: "[0][0][0][0]",
    }),
    null,
  )
})

test("buildAudioCodecString maps aac to AAC-LC", () => {
  assert.equal(buildAudioCodecString({ codec_name: "aac" }), "mp4a.40.2")
  assert.equal(buildAudioCodecString({ codec_name: "opus" }), null)
})
