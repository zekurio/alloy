import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { playbackDuration, toPlaybackTime } from "./video-player-timeline"

test("initial playback starts at the requested in-range frame", () => {
  assert.equal(toPlaybackTime(7, 10.2, undefined), 7)
  assert.equal(toPlaybackTime(12, 10.2, undefined), 10.2)
})

test("a duration hint keeps fragmented playback on a stable timeline", () => {
  const durationHint = 120

  assert.equal(playbackDuration(12, undefined, durationHint), durationHint)
  assert.equal(playbackDuration(84, undefined, durationHint), durationHint)
  assert.equal(
    playbackDuration(42, { start: 30, end: 150 }, durationHint),
    durationHint,
  )
  assert.equal(
    toPlaybackTime(42, 42, { start: 30, end: 150 }, durationHint),
    12,
  )
})
