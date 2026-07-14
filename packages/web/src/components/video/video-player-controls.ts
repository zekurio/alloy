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

import type { PlayerCoreProps } from "./video-player-core-types"
import type { VideoKeyCommand } from "./video-player-shell"

interface VideoPlayerControlsOptions {
  containerRef: RefObject<HTMLDivElement | null>
  duration: number
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
  containerRef,
  duration,
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
  useImperativeHandle(
    playerRef,
    () => ({
      play: () => playInternal(),
      pause: () => pauseInternal(),
      seek: (seconds: number, keepPlaying?: boolean) =>
        seekInternal(seconds, keepPlaying),
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      getDuration: () => {
        const value = videoRef.current?.duration ?? 0
        return Number.isFinite(value) ? value : 0
      },
      setVolume: (next: number) => {
        const clamped = Math.max(0, Math.min(1, next))
        volumeRef.current = clamped
        setVolumeState(clamped)
        const video = videoRef.current
        if (video) video.volume = clamped
      },
      setMuted: (next: boolean) => {
        mutedRef.current = next
        setMutedState(next)
        const video = videoRef.current
        if (video) video.muted = next
      },
      setPlaybackRate: (rate: number) => {
        const video = videoRef.current
        if (video) video.playbackRate = rate
      },
    }),
    [pauseInternal, playInternal, seekInternal],
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

  const toggleMute = useCallback(() => {
    setMutedState((current) => {
      const next = !current
      mutedRef.current = next
      const video = videoRef.current
      if (video) video.muted = next
      return next
    })
  }, [mutedRef, setMutedState, videoRef])

  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next))
      volumeRef.current = clamped
      setVolumeState(clamped)
      setMutedState((currentMuted) => {
        const nextMuted = clamped > 0 ? false : currentMuted
        mutedRef.current = nextMuted
        const video = videoRef.current
        if (video) {
          video.volume = clamped
          video.muted = nextMuted
        }
        return nextMuted
      })
    },
    [mutedRef, setMutedState, setVolumeState, videoRef, volumeRef],
  )

  const volumeBy = useCallback(
    (delta: number) => {
      setVolume(volumeRef.current + delta)
    },
    [setVolume, volumeRef],
  )

  const seekBy = useCallback(
    (deltaSec: number) => {
      const video = videoRef.current
      if (!video) return
      seekInternal((video.currentTime || 0) + deltaSec)
    },
    [seekInternal, videoRef],
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

  return { keyCommand, setVolume, toggleFullscreen, toggleMute, togglePlay }
}
