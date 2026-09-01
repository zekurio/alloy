import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import {
  initialPlaybackTime,
  playbackDuration,
  toPlaybackTime,
} from "./video-player-timeline"

test("initial playback starts at the requested in-range frame", () => {
  assert.equal(initialPlaybackTime(7, 10.2), 7)
  assert.equal(initialPlaybackTime(12, 10.2), 10.2)
  assert.equal(initialPlaybackTime(7, 0), 7)
  assert.equal(initialPlaybackTime(Number.NaN, 10.2), 0)
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
