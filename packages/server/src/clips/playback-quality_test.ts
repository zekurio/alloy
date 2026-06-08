import assert from "node:assert/strict"
import { test } from "node:test"

import { buildPlaybackQualities } from "./playback-quality"

function inputForSourceBitrate(bitrate: number, height = 2160) {
  return {
    width: Math.round((height * 16) / 9),
    height,
    durationMs: 1000,
    sourceSizeBytes: bitrate / 8,
  }
}

test("buildPlaybackQualities uses the source bitrate as the highest option", () => {
  const qualities = buildPlaybackQualities(inputForSourceBitrate(55_000_000))

  assert.equal(qualities[0]?.bitrate, 55_000_000)
  assert.equal(qualities[0]?.label, "2160p - 55 Mbps")
  assert.equal(qualities[1]?.bitrate, 40_000_000)
})

test("buildPlaybackQualities keeps high source bitrates for lower-resolution clips", () => {
  const qualities = buildPlaybackQualities(
    inputForSourceBitrate(120_000_000, 1080),
  )

  assert.equal(qualities[0]?.bitrate, 120_000_000)
  assert.equal(qualities[0]?.height, 1080)
  assert.equal(qualities[1]?.bitrate, 8_000_000)
})
