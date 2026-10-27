import { useDocumentEvent } from "@alloy/ui/hooks/use-document-event"
import { useCallback, useImperativeHandle, useMemo, useRef } from "react"
import type { RefObject } from "react"

import {
  exitFullscreenBestEffort,
  isFullscreenElement,
  requestFullscreenBestEffort,
} from "@/lib/fullscreen"
import {
  flushPlayerVolume,
  readPlayerVolume,
  writePlayerVolume,
} from "@/lib/player-volume"

import type { PlayerCoreProps } from "./video-player-core-types"
import type { VideoKeyCommand } from "./video-player-shell"
import type { PlayerStore } from "./video-player-store"

interface VideoPlayerControlsOptions {
  store: PlayerStore
  containerRef: RefObject<HTMLDivElement | null>
  getCurrentTime: () => number
  getDuration: () => number
  isCoarsePointer: boolean
  pauseInternal: () => void
  playerRef: PlayerCoreProps["playerRef"]
  playInternal: (reportBlocked?: boolean) => Promise<void>
  seekInternal: (targetSec: number, keepPlaying?: boolean) => void
  setChromeVisible: (visible: boolean) => void
  shortcutBounds: PlayerCoreProps["shortcutBounds"]
  videoRef: RefObject<HTMLVideoElement | null>
}

export function useVideoPlayerControls({
  store,
  containerRef,
  getCurrentTime,
  getDuration,
  isCoarsePointer,
  pauseInternal,
  playerRef,
  playInternal,
  seekInternal,
  setChromeVisible,
  shortcutBounds,
  videoRef,
}: VideoPlayerControlsOptions) {
  // Volume lives in the shared player-volume store. The element is written
  // here too, inside the gesture, so unmuting counts as user activation for
  // the play() that may follow.
  const setMuted = useCallback(
    (next: boolean) => {
      const video = videoRef.current
      if (video) video.muted = next
      writePlayerVolume({ volume: readPlayerVolume().volume, muted: next })
    },
    [videoRef],
  )

  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next))
      const nextMuted = clamped > 0 ? false : readPlayerVolume().muted
      const video = videoRef.current
      if (video) {
        video.volume = clamped
        video.muted = nextMuted
      }
      writePlayerVolume({ volume: clamped, muted: nextMuted })
    },
    [videoRef],
  )

  const setPlaybackRate = useCallback(
    (playbackRate: number) => {
      store.setState({ playbackRate })
      const video = videoRef.current
      if (video) video.playbackRate = playbackRate
    },
    [store, videoRef],
  )

  useImperativeHandle(
    playerRef,
    () => ({
      play: () => playInternal(),
      pause: () => pauseInternal(),
      seek: (seconds: number, keepPlaying?: boolean) =>
        seekInternal(seconds, keepPlaying),
      getCurrentTime,
      getDuration,
      setVolume,
      setMuted,
      setPlaybackRate,
    }),
    [
      getCurrentTime,
      getDuration,
      pauseInternal,
      playInternal,
      seekInternal,
      setMuted,
      setPlaybackRate,
      setVolume,
    ],
  )

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused || video.ended) {
      void playInternal()
      return
    }
    pauseInternal()
  }, [pauseInternal, playInternal, videoRef])

  const toggleMute = useCallback(
    () => setMuted(!readPlayerVolume().muted),
    [setMuted],
  )

  const volumeBy = useCallback(
    (delta: number) => {
      setVolume(readPlayerVolume().volume + delta)
    },
    [setVolume],
  )

  const seekBy = useCallback(
    (deltaSec: number) => seekInternal(getCurrentTime() + deltaSec),
    [getCurrentTime, seekInternal],
  )

  const toggleFullscreen = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    if (isFullscreenElement(element)) {
      exitFullscreenBestEffort("video player")
      return
    }
    requestFullscreenBestEffort(element, "video player")
  }, [containerRef])

  // Entering or leaving fullscreen re-reveals the chrome, and on touch
  // devices releases the orientation lock so the clip can rotate. Other
  // elements' fullscreen changes fire here too, hence the remembered state.
  const fullscreenRef = useRef(false)
  useDocumentEvent("fullscreenchange", () => {
    const fullscreen = isFullscreenElement(containerRef.current)
    if (fullscreen === fullscreenRef.current) return
    fullscreenRef.current = fullscreen
    if (fullscreen && isCoarsePointer) screen.orientation?.unlock?.()
    setChromeVisible(true)
  })

  const keyCommand = useMemo<VideoKeyCommand>(
    () => ({
      togglePlay,
      toggleMute,
      seekBy,
      seekTo: (seconds) =>
        seekInternal(
          Number.isFinite(seconds) ? seconds : store.getState().duration,
        ),
      seekPercent: (percent) => {
        const start = Math.max(0, shortcutBounds?.start ?? 0)
        const end =
          shortcutBounds?.end !== undefined &&
          Number.isFinite(shortcutBounds.end)
            ? shortcutBounds.end
            : store.getState().duration
        const span = Math.max(0, end - start)
        seekInternal(start + span * Math.min(1, Math.max(0, percent)))
      },
      volumeBy,
      toggleFullscreen,
    }),
    [
      store,
      seekBy,
      seekInternal,
      shortcutBounds?.end,
      shortcutBounds?.start,
      toggleFullscreen,
      toggleMute,
      togglePlay,
      volumeBy,
    ],
  )

  return {
    keyCommand,
    setPlaybackRate,
    setVolume,
    finishVolumeChange: flushPlayerVolume,
    toggleFullscreen,
    toggleMute,
    togglePlay,
  }
}
