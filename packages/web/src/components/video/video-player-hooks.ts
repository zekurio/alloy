import { useDocumentEvent } from "@alloy/ui/hooks/use-document-event"
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import type { RefObject } from "react"

import { isFullscreenElement } from "@/lib/fullscreen"

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

/** The player container while it is the fullscreen element, else null. */
export function useFullscreenContainer(
  containerRef: RefObject<HTMLDivElement | null>,
): HTMLDivElement | null {
  const [fullscreenContainer, setFullscreenContainer] =
    useState<HTMLDivElement | null>(null)

  const onFullscreenChange = useCallback(() => {
    const container = containerRef.current
    setFullscreenContainer(isFullscreenElement(container) ? container : null)
  }, [containerRef])

  useEffect(() => {
    onFullscreenChange()
  }, [onFullscreenChange])
  useDocumentEvent("fullscreenchange", onFullscreenChange)

  return fullscreenContainer
}

/** Calls `onFrame` on every animation frame while `active` is true. */
export function useFrameLoop(active: boolean, onFrame: () => void): void {
  const frame = useEffectEvent(onFrame)

  useEffect(() => {
    if (!active) return
    let rafId = 0
    const tick = () => {
      frame()
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [active])
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
