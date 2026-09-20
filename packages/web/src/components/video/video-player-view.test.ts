import assert from "node:assert/strict"

import { test } from "vitest"

import { createPlayThresholdTracker } from "./video-player-view"

function played(...ranges: [number, number][]): TimeRanges {
  return {
    length: ranges.length,
    start: (index) => ranges[index][0],
    end: (index) => ranges[index][1],
  }
}

test.each([1, 5, 15, 30, 60, 120])(
  "a %s-second clip qualifies at exactly 20%%, once per viewing",
  (duration) => {
    const track = createPlayThresholdTracker()
    const sample = { identity: "clip", mediaDuration: duration }
    const threshold = duration * 0.2

    assert.equal(
      track({ ...sample, played: played([0, threshold - 0.01]) }),
      false,
    )
    assert.equal(track({ ...sample, played: played([0, threshold]) }), true)
    assert.equal(track({ ...sample, played: played([0, duration]) }), false)
  },
)

test("only watched portions count, including after seeks, pauses, and quality changes", () => {
  const track = createPlayThresholdTracker()
  const sample = { identity: "clip", mediaDuration: 30 }
  assert.equal(track({ ...sample, played: played([0, 2]) }), false)

  // Pausing or buffering leaves played unchanged, regardless of elapsed time.
  for (let i = 0; i < 100; i++) {
    assert.equal(track({ ...sample, played: played([0, 2]) }), false)
  }
  // A seek to 20 seconds doesn't count the skipped gap.
  assert.equal(track({ ...sample, played: played([0, 2], [20, 21]) }), false)
  // Reloading a quality resets native played ranges, not our clip history.
  assert.equal(track({ ...sample, played: played() }), false)
  // Replaying an overlapping portion must not count it twice.
  assert.equal(track({ ...sample, played: played([20, 22]) }), false)
  assert.equal(track({ ...sample, played: played([20, 24]) }), true)
  assert.equal(track({ ...sample, played: played([20, 25]) }), false)
})

test("another clip or a new cut starts a fresh viewing", () => {
  const track = createPlayThresholdTracker()
  const sample = { identity: "clip:cut1", mediaDuration: 10 }
  assert.equal(track({ ...sample, played: played([0, 1]) }), false)
  assert.equal(
    track({ ...sample, identity: "other", played: played([1, 2]) }),
    false,
  )
  assert.equal(
    track({ ...sample, identity: "other", played: played([1, 3]) }),
    true,
  )
  assert.equal(track({ ...sample, played: played([0, 2]) }), true)
  assert.equal(
    track({ ...sample, identity: "clip:cut2", played: played([0, 1]) }),
    false,
  )
  assert.equal(
    track({ ...sample, identity: "clip:cut2", played: played([0, 2]) }),
    true,
  )
})

test("qualification waits for a real duration and uses the effective clip timeline", () => {
  const track = createPlayThresholdTracker()
  for (const mediaDuration of [0, NaN, Infinity]) {
    assert.equal(
      track({ identity: "unknown", mediaDuration, played: played([0, 30]) }),
      false,
    )
  }
  assert.equal(
    track({ identity: "unknown", mediaDuration: 150, played: played([0, 30]) }),
    true,
  )

  // A server duration hint takes precedence over partial media metadata.
  const hinted = {
    identity: "fragmented",
    mediaDuration: 12,
    durationHint: 120,
  }
  assert.equal(track({ ...hinted, played: played([0, 12]) }), false)
  assert.equal(
    track({ ...hinted, mediaDuration: 48, played: played([0, 24]) }),
    true,
  )

  // Only the final ten-second cut counts, not playback outside its bounds.
  const trimmed = {
    identity: "trimmed",
    mediaDuration: 120,
    playbackRange: { start: 30, end: 40 },
  }
  assert.equal(track({ ...trimmed, played: played([0, 31], [40, 60]) }), false)
  // A cut rendition has a zero-based timeline but shares the same identity.
  assert.equal(
    track({ identity: "trimmed", mediaDuration: 10, played: played([1, 2]) }),
    true,
  )
})
