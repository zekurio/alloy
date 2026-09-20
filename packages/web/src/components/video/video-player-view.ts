import {
  finiteMediaDuration,
  playbackDuration,
  toPlaybackTime,
} from "./video-player-timeline"
import type { MediaPlaybackRange } from "./video-player-types"

type PlayedRange = { start: number; end: number }

type PlaybackSample = {
  identity: string
  played: TimeRanges
  mediaDuration: number
  playbackRange?: MediaPlaybackRange
  durationHint?: number
}

// Keep watched portions on the clip's timeline across quality switches.
// The browser's played ranges exclude seeks, pauses, and buffering; merging
// them also prevents replaying the same portion from qualifying by itself.
export function createPlayThresholdTracker() {
  let identity: string | undefined
  let watched: PlayedRange[] = []
  let fired = false

  return (sample: PlaybackSample): boolean => {
    if (identity !== sample.identity) {
      identity = sample.identity
      watched = []
      fired = false
    }
    if (fired) return false

    const mediaDuration = finiteMediaDuration(sample.mediaDuration)
    const duration = playbackDuration(
      mediaDuration,
      sample.playbackRange,
      sample.durationHint,
    )
    if (!Number.isFinite(duration) || duration <= 0) return false

    const ranges = [...watched]
    for (let i = 0; i < sample.played.length; i++) {
      const start = toPlaybackTime(
        sample.played.start(i),
        mediaDuration,
        sample.playbackRange,
        sample.durationHint,
      )
      const end = toPlaybackTime(
        sample.played.end(i),
        mediaDuration,
        sample.playbackRange,
        sample.durationHint,
      )
      if (end > start) ranges.push({ start, end })
    }
    ranges.sort((a, b) => a.start - b.start)
    watched = []
    for (const range of ranges) {
      const previous = watched[watched.length - 1]
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end)
      } else {
        watched.push({ ...range })
      }
    }

    const watchedSeconds = watched.reduce(
      (total, range) => total + range.end - range.start,
      0,
    )
    fired = watchedSeconds >= duration * 0.2
    return fired
  }
}
