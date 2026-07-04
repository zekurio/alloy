import { useCallback, useEffect, useRef, useState } from "react"

import type { VideoPlayerHandle } from "@/components/video/video-player-types"

export const MIN_TRIM_MS = 1000
/** Tolerance when deciding whether the trim still covers the full clip. */
export const FULL_CLIP_TOLERANCE_MS = 50

/**
 * The single-range trim state machine shared by the local capture editor and
 * the uploaded clip editor: one kept source range, the playhead in source
 * time, and playback that loops within the trimmed range.
 */
export function useTrimPlayback({
  initialDurationMs,
  initialTrim,
  canTrim = true,
}: {
  initialDurationMs: number
  initialTrim?: { startMs: number; endMs: number }
  canTrim?: boolean
}) {
  const playerRef = useRef<VideoPlayerHandle | null>(null)
  const [playing, setPlaying] = useState(false)
  const [durationMs, setDurationMs] = useState(initialDurationMs)
  const [trim, setTrim] = useState(() =>
    initialTrim
      ? {
          startMs: Math.min(
            Math.max(0, initialTrim.startMs),
            Math.max(0, initialDurationMs - MIN_TRIM_MS),
          ),
          endMs: Math.max(
            Math.min(initialDurationMs, initialTrim.endMs),
            Math.min(initialDurationMs, initialTrim.startMs + MIN_TRIM_MS),
          ),
        }
      : {
          startMs: 0,
          endMs: initialDurationMs,
        },
  )
  // The playhead position lives outside React state: the playback loop
  // publishes it every animation frame, and rendering it through setState
  // would reconcile the whole editor subtree at 60fps. Leaf components
  // subscribe via useSyncExternalStore so only they re-render per frame.
  const currentMsRef = useRef(0)
  const currentMsListenersRef = useRef(new Set<() => void>())
  const setCurrentMs = useCallback((next: number) => {
    currentMsRef.current = next
    for (const listener of currentMsListenersRef.current) listener()
  }, [])
  const subscribeCurrentMs = useCallback((listener: () => void) => {
    currentMsListenersRef.current.add(listener)
    return () => {
      currentMsListenersRef.current.delete(listener)
    }
  }, [])
  const getCurrentMs = useCallback(() => currentMsRef.current, [])
  const trimRef = useRef(trim)
  trimRef.current = trim

  // While playing, an animation-frame loop follows the player and loops
  // playback back to the trim start when it runs past the trim end.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const player = playerRef.current
      if (player) {
        const sourceMs = player.getCurrentTime() * 1000
        const { startMs, endMs } = trimRef.current
        if (endMs > startMs && sourceMs >= endMs - 10) {
          player.seek(startMs / 1000)
          setCurrentMs(startMs)
        } else {
          setCurrentMs(sourceMs)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const handleTimeUpdate = () => {
    // The player reports the real duration once metadata lands; adopt it and
    // re-fit the trim into the actual media bounds.
    const reported = Math.round((playerRef.current?.getDuration() ?? 0) * 1000)
    if (reported > 0 && reported !== durationMs) {
      setDurationMs(reported)
      setTrim((current) => ({
        startMs: Math.min(current.startMs, Math.max(0, reported - MIN_TRIM_MS)),
        // An untouched full-range trim simply adopts the new duration.
        endMs:
          current.endMs <= 0 ||
          current.endMs >= durationMs - FULL_CLIP_TOLERANCE_MS
            ? reported
            : Math.min(current.endMs, reported),
      }))
    }
  }

  const seek = (sourceMs: number) => {
    const clamped = Math.min(Math.max(0, sourceMs), durationMs || sourceMs)
    setCurrentMs(clamped)
    playerRef.current?.seek(clamped / 1000, false)
  }

  const togglePlayback = () => {
    const player = playerRef.current
    if (!player) return
    if (playing) {
      player.pause()
      return
    }
    // Restart from the trim start once the range has fully played, and pull
    // a playhead parked before the range into it.
    let target = currentMsRef.current
    if (target >= trim.endMs - 10 || target < trim.startMs) {
      target = trim.startMs
      setCurrentMs(target)
    }
    if (Math.abs(player.getCurrentTime() * 1000 - target) > 80) {
      player.seek(target / 1000)
    }
    void player.play()
  }

  const stopPlayback = () => {
    const player = playerRef.current
    if (!player) return
    player.pause()
    // Seek without resuming: the player still reports "playing" until the
    // pause event lands, so a plain seek would restart playback.
    setCurrentMs(trim.startMs)
    player.seek(trim.startMs / 1000, false)
  }

  const handleEnded = () => {
    seek(trim.startMs)
    void playerRef.current?.play()
  }

  // Trim handles update live while dragging: the edge follows the pointer
  // and the (paused) player scrubs to the cut frame.
  const handleTrimStartChange = (sourceMs: number) => {
    if (!canTrim) return
    const clamped = Math.round(
      Math.min(Math.max(0, sourceMs), trim.endMs - MIN_TRIM_MS),
    )
    setTrim((current) => ({ ...current, startMs: clamped }))
    playerRef.current?.pause()
    setCurrentMs(clamped)
    playerRef.current?.seek(clamped / 1000, false)
  }

  const handleTrimEndChange = (sourceMs: number) => {
    if (!canTrim) return
    const clamped = Math.round(
      Math.max(Math.min(durationMs, sourceMs), trim.startMs + MIN_TRIM_MS),
    )
    setTrim((current) => ({ ...current, endMs: clamped }))
    playerRef.current?.pause()
    setCurrentMs(clamped)
    playerRef.current?.seek(clamped / 1000, false)
  }

  // Dragging the grab bar slides the whole kept range: length is preserved,
  // both edges clamp to the media bounds, and the (paused) player scrubs to
  // the new cut-in frame.
  const handleTrimMove = (sourceStartMs: number) => {
    if (!canTrim) return
    const lengthMs = trim.endMs - trim.startMs
    if (lengthMs <= 0) return
    const maxStartMs = Math.max(0, durationMs - lengthMs)
    const clamped = Math.round(Math.min(Math.max(0, sourceStartMs), maxStartMs))
    setTrim({ startMs: clamped, endMs: clamped + lengthMs })
    playerRef.current?.pause()
    setCurrentMs(clamped)
    playerRef.current?.seek(clamped / 1000, false)
  }

  const resetTrim = () => {
    setTrim({ startMs: 0, endMs: durationMs })
  }

  const rangeMs = Math.max(0, trim.endMs - trim.startMs)
  const trimmed =
    durationMs > 0 &&
    (trim.startMs > FULL_CLIP_TOLERANCE_MS ||
      trim.endMs < durationMs - FULL_CLIP_TOLERANCE_MS)

  return {
    playerRef,
    playing,
    setPlaying,
    durationMs,
    trim,
    setTrim,
    subscribeCurrentMs,
    getCurrentMs,
    setCurrentMs,
    rangeMs,
    trimmed,
    handleTimeUpdate,
    seek,
    togglePlayback,
    stopPlayback,
    handleEnded,
    handleTrimStartChange,
    handleTrimEndChange,
    handleTrimMove,
    resetTrim,
  }
}

export type TrimPlayback = ReturnType<typeof useTrimPlayback>
