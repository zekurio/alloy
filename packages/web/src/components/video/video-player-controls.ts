import { useDocumentEvent } from "@alloy/ui/hooks/use-document-event"
import { useCallback, useEffect, useImperativeHandle, useMemo } from "react"
import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react"

import {
  exitFullscreenBestEffort,
  isFullscreenElement,
  requestFullscreenBestEffort,
} from "@/lib/fullscreen"
import { flushPlayerVolume, writePlayerVolume } from "@/lib/player-volume"

import type { PlayerCoreProps } from "./video-player-core-types"
import type { VideoKeyCommand } from "./video-player-shell"

interface VideoPlayerControlsOptions {
  audioMixerEngagedRef: MutableRefObject<boolean>
  containerRef: RefObject<HTMLDivElement | null>
  duration: number
  getCurrentTime: () => number
  getDuration: () => number
  isCoarsePointer: boolean
  mutedRef: MutableRefObject<boolean>
  pauseInternal: () => void
  playerRef: PlayerCoreProps["playerRef"]
  playInternal: (reportBlocked?: boolean) => Promise<void>
  seekInternal: (targetSec: number, keepPlaying?: boolean) => void
  setChromeVisible: Dispatch<SetStateAction<boolean>>
  setMutedState: Dispatch<SetStateAction<boolean>>
  setVolumeState: Dispatch<SetStateAction<number>>
  shortcutBounds: PlayerCoreProps["shortcutBounds"]
  videoRef: RefObject<HTMLVideoElement | null>
  volumeRef: MutableRefObject<number>
}

export function useVideoPlayerControls({
  audioMixerEngagedRef,
  containerRef,
  duration,
  getCurrentTime,
  getDuration,
  isCoarsePointer,
  mutedRef,
  pauseInternal,
  playerRef,
  playInternal,
  seekInternal,
  setChromeVisible,
  setMutedState,
  setVolumeState,
  shortcutBounds,
  videoRef,
  volumeRef,
}: VideoPlayerControlsOptions) {
  const setMuted = useCallback(
    (next: boolean) => {
      mutedRef.current = next
      setMutedState(next)
      const video = videoRef.current
      if (video) video.muted = next || audioMixerEngagedRef.current
      writePlayerVolume({ volume: volumeRef.current, muted: next })
    },
    [audioMixerEngagedRef, mutedRef, setMutedState, videoRef, volumeRef],
  )

  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next))
      const nextMuted = clamped > 0 ? false : mutedRef.current
      volumeRef.current = clamped
      mutedRef.current = nextMuted
      setVolumeState(clamped)
      setMutedState(nextMuted)
      const video = videoRef.current
      if (video) {
        video.volume = clamped
        video.muted = nextMuted || audioMixerEngagedRef.current
      }
      writePlayerVolume({ volume: clamped, muted: nextMuted })
    },
    [
      audioMixerEngagedRef,
      mutedRef,
      setMutedState,
      setVolumeState,
      videoRef,
      volumeRef,
    ],
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
      setPlaybackRate: (rate: number) => {
        const video = videoRef.current
        if (video) video.playbackRate = rate
      },
    }),
    [
      getCurrentTime,
      getDuration,
      pauseInternal,
      playInternal,
      seekInternal,
      setMuted,
      setVolume,
      videoRef,
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
    () => setMuted(!mutedRef.current),
    [mutedRef, setMuted],
  )

  const volumeBy = useCallback(
    (delta: number) => {
      setVolume(volumeRef.current + delta)
    },
    [setVolume, volumeRef],
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

  const onFullscreenChange = useCallback(() => {
    const nextIsFullscreen = isFullscreenElement(containerRef.current)
    if (nextIsFullscreen && isCoarsePointer) screen.orientation?.unlock?.()
    setChromeVisible(true)
  }, [containerRef, isCoarsePointer, setChromeVisible])

  useEffect(() => {
    onFullscreenChange()
  }, [onFullscreenChange])
  useDocumentEvent("fullscreenchange", onFullscreenChange)

  const keyCommand = useMemo<VideoKeyCommand>(
    () => ({
      togglePlay,
      toggleMute,
      seekBy,
      seekTo: (seconds) =>
        seekInternal(Number.isFinite(seconds) ? seconds : duration),
      seekPercent: (percent) => {
        const start = Math.max(0, shortcutBounds?.start ?? 0)
        const end =
          shortcutBounds?.end !== undefined &&
          Number.isFinite(shortcutBounds.end)
            ? shortcutBounds.end
            : duration
        const span = Math.max(0, end - start)
        seekInternal(start + span * Math.min(1, Math.max(0, percent)))
      },
      volumeBy,
      toggleFullscreen,
    }),
    [
      duration,
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
    setVolume,
    finishVolumeChange: flushPlayerVolume,
    toggleFullscreen,
    toggleMute,
    togglePlay,
  }
}
