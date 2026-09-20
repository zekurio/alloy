import { useCallback, useEffect, useRef, useState } from "react"

import type { MediaPlaybackRange } from "./video-player-types"
import { createPlayThresholdTracker } from "./video-player-view"

// Owns the chrome bar's visibility plus the auto-hide timer. Kept out of
// PlayerCore so the timer ref and its scheduling can't be poked from unrelated
// code paths; the auto-hide effect and pointer handlers stay in the player and
// drive it through the returned setters.
export function useVideoChromeVisibility(isCoarsePointer: boolean) {
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeHideTimerRef = useRef<number | null>(null)

  const clearChromeHideTimer = useCallback(() => {
    if (chromeHideTimerRef.current === null) return
    window.clearTimeout(chromeHideTimerRef.current)
    chromeHideTimerRef.current = null
  }, [])

  const scheduleChromeHide = useCallback(
    (delayMs = isCoarsePointer ? 2600 : 1600) => {
      clearChromeHideTimer()
      chromeHideTimerRef.current = window.setTimeout(() => {
        setChromeVisible(false)
        chromeHideTimerRef.current = null
      }, delayMs)
    },
    [clearChromeHideTimer, isCoarsePointer],
  )

  return {
    chromeVisible,
    setChromeVisible,
    scheduleChromeHide,
    clearChromeHideTimer,
  }
}

export function usePlayingTimeSync(
  playing: boolean,
  syncTime: () => void,
): void {
  useEffect(() => {
    if (!playing) return
    let rafId = 0
    const tick = () => {
      syncTime()
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [playing, syncTime])
}

export function usePlayThreshold({
  identity,
  playbackRange,
  durationHint,
  onPlayThreshold,
}: {
  identity: string
  playbackRange: MediaPlaybackRange | undefined
  durationHint: number | undefined
  onPlayThreshold: (() => void) | undefined
}): (video: HTMLVideoElement) => void {
  const callbackRef = useRef(onPlayThreshold)
  useEffect(() => {
    callbackRef.current = onPlayThreshold
  }, [onPlayThreshold])

  const trackPlaybackRef = useRef(createPlayThresholdTracker())
  return useCallback(
    (video: HTMLVideoElement) => {
      if (!callbackRef.current) return
      const qualified = trackPlaybackRef.current({
        identity,
        played: video.played,
        mediaDuration: video.duration,
        playbackRange,
        durationHint,
      })
      if (qualified) callbackRef.current()
    },
    [identity, playbackRange, durationHint],
  )
}
