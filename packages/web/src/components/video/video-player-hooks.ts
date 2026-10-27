import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useSyncExternalStore,
} from "react"
import type { RefObject } from "react"

import { isFullscreenElement } from "@/lib/fullscreen"

import type { PlayerStore } from "./video-player-store"
import type { MediaPlaybackRange } from "./video-player-types"
import { createPlayThresholdTracker } from "./video-player-view"

// Owns the auto-hide timer for the chrome bar, whose visibility lives in the
// player store. Kept out of PlayerCore so the timer ref and its scheduling
// can't be poked from unrelated code paths; the auto-hide effect and pointer
// handlers stay in the player and drive it through the returned setters.
export function useVideoChromeVisibility(
  store: PlayerStore,
  isCoarsePointer: boolean,
) {
  const chromeHideTimerRef = useRef<number | null>(null)

  const setChromeVisible = useCallback(
    (chromeVisible: boolean) => store.setState({ chromeVisible }),
    [store],
  )

  const clearChromeHideTimer = useCallback(() => {
    if (chromeHideTimerRef.current === null) return
    window.clearTimeout(chromeHideTimerRef.current)
    chromeHideTimerRef.current = null
  }, [])

  const scheduleChromeHide = useCallback(
    (delayMs = isCoarsePointer ? 2600 : 1600) => {
      clearChromeHideTimer()
      chromeHideTimerRef.current = window.setTimeout(() => {
        store.setState({ chromeVisible: false })
        chromeHideTimerRef.current = null
      }, delayMs)
    },
    [clearChromeHideTimer, isCoarsePointer, store],
  )

  useEffect(() => clearChromeHideTimer, [clearChromeHideTimer])

  return { setChromeVisible, scheduleChromeHide, clearChromeHideTimer }
}

function subscribeFullscreenChange(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange)
  return () => document.removeEventListener("fullscreenchange", onChange)
}

/** The player container while it is the fullscreen element, else null. */
export function useFullscreenContainer(
  containerRef: RefObject<HTMLDivElement | null>,
): HTMLDivElement | null {
  const getSnapshot = useCallback(() => {
    const container = containerRef.current
    return isFullscreenElement(container) ? container : null
  }, [containerRef])

  return useSyncExternalStore(subscribeFullscreenChange, getSnapshot)
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

  const trackPlaybackRef = useRef<ReturnType<
    typeof createPlayThresholdTracker
  > | null>(null)
  return useCallback(
    (video: HTMLVideoElement) => {
      if (!callbackRef.current) return
      trackPlaybackRef.current ??= createPlayThresholdTracker()
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
