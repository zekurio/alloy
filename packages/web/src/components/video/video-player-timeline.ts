import type { MediaPlaybackRange } from "./video-player-types"

export function finiteMediaDuration(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

export function playbackDuration(
  mediaDuration: number,
  range: MediaPlaybackRange | undefined,
  durationHint?: number,
): number {
  const hint = finiteMediaDuration(durationHint ?? 0)
  if (hint > 0) return hint
  if (!range) return mediaDuration
  const start = Math.max(0, range.start)
  const end = mediaDuration > 0 ? Math.min(range.end, mediaDuration) : range.end
  return Number.isFinite(end) ? Math.max(0, end - start) : 0
}

export function toPlaybackTime(
  mediaTime: number,
  mediaDuration: number,
  range: MediaPlaybackRange | undefined,
  durationHint?: number,
): number {
  const time = range ? mediaTime - Math.max(0, range.start) : mediaTime
  return Math.max(
    0,
    Math.min(playbackDuration(mediaDuration, range, durationHint), time),
  )
}

export function toMediaTime(
  playbackTime: number,
  mediaDuration: number,
  range: MediaPlaybackRange | undefined,
  durationHint?: number,
): number {
  const clamped = Math.max(
    0,
    Math.min(
      playbackDuration(mediaDuration, range, durationHint),
      playbackTime,
    ),
  )
  return range ? Math.max(0, range.start) + clamped : clamped
}

/**
 * The element's position and length in playback time, with converters that
 * share its media duration. Read it fresh: the values go stale as soon as the
 * element advances or loads new metadata.
 */
export function readPlaybackClock(
  video: HTMLVideoElement,
  range: MediaPlaybackRange | undefined,
  durationHint: number | undefined,
) {
  const mediaDuration = finiteMediaDuration(video.duration)
  return {
    duration: playbackDuration(mediaDuration, range, durationHint),
    currentTime: toPlaybackTime(
      video.currentTime || 0,
      mediaDuration,
      range,
      durationHint,
    ),
    toPlaybackTime: (mediaTime: number) =>
      toPlaybackTime(mediaTime, mediaDuration, range, durationHint),
    toMediaTime: (playbackTime: number) =>
      toMediaTime(playbackTime, mediaDuration, range, durationHint),
  }
}
