import { useCallback, useEffect } from "react"
import type { Dispatch, RefObject, SetStateAction } from "react"

import type { PlayerCoreProps } from "./video-player-core-types"
import type { LoadStatus } from "./video-player-shell"
import {
  finiteMediaDuration,
  playbackDuration,
  toMediaTime,
  toPlaybackTime,
} from "./video-player-timeline"
import type { MediaPlaybackRange } from "./video-player-types"

type ResumeState = { time: number; play: boolean }
type SourceState = { identity: string; mediaKey: string }

export type VideoPlayerEventsOptions = {
  videoRef: RefObject<HTMLVideoElement | null>
  identity: string
  mediaKey: string
  activePlaybackRange: MediaPlaybackRange | undefined
  durationHint: number | undefined
  playbackRate: number
  initialTime: number
  autoPlay: boolean
  loop: boolean
  isCoarsePointer: boolean
  clearBuffering: () => void
  clearChromeHideTimer: () => void
  setChromeVisible: Dispatch<SetStateAction<boolean>>
  setStatus: Dispatch<SetStateAction<LoadStatus>>
  setDuration: Dispatch<SetStateAction<number>>
  setCurrentTime: Dispatch<SetStateAction<number>>
  setBufferedEnd: Dispatch<SetStateAction<number>>
  setHasRenderedFrame: Dispatch<SetStateAction<boolean>>
  setPlayingState: (playing: boolean) => void
  syncBuffered: () => void
  syncTime: () => void
  playInternal: (reportBlocked?: boolean) => Promise<void>
  volumeRef: RefObject<number>
  mutedRef: RefObject<boolean>
  playingRef: RefObject<boolean>
  lastTimeRef: RefObject<number>
  playRequestIdRef: RefObject<number>
  hasRenderedFrameRef: RefObject<boolean>
  rangeEndedRef: RefObject<boolean>
  resumeRef: RefObject<ResumeState | null>
  prevSourceRef: RefObject<SourceState | null>
  onFrameReadyRef: RefObject<PlayerCoreProps["onFrameReady"] | undefined>
  onEndedRef: RefObject<PlayerCoreProps["onEnded"] | undefined>
}

type LoadedHandlers = {
  handleLoadedMetadata: () => void
  handleLoadedData: () => void
}

export function useVideoPlayerEvents(options: VideoPlayerEventsOptions) {
  const { clearBuffering } = options
  const handleLoadedData = useLoadedData(options)
  const handleLoadedMetadata = useLoadedMetadata(options)
  useMediaSourceLifecycle(options, { handleLoadedMetadata, handleLoadedData })
  const handleCanPlay = useCallback(() => {
    handleLoadedData()
    clearBuffering()
  }, [clearBuffering, handleLoadedData])
  const handleTimeUpdate = useTimeUpdate(options)
  const handlePlaying = usePlaying(options, handleLoadedData)
  const handleEnded = useEnded(options)
  return {
    handleLoadedMetadata,
    handleLoadedData,
    handleCanPlay,
    handleTimeUpdate,
    handlePlaying,
    handleEnded,
  }
}

function useLoadedData({
  hasRenderedFrameRef,
  setHasRenderedFrame,
  onFrameReadyRef,
}: VideoPlayerEventsOptions) {
  return useCallback(() => {
    if (hasRenderedFrameRef.current) return
    hasRenderedFrameRef.current = true
    setHasRenderedFrame(true)
    onFrameReadyRef.current?.()
  }, [])
}

function useLoadedMetadata(options: VideoPlayerEventsOptions) {
  const {
    activePlaybackRange,
    autoPlay,
    clearBuffering,
    durationHint,
    initialTime,
    playbackRate,
    playInternal,
    syncBuffered,
  } = options
  return useCallback(
    () => loadMetadata(options),
    [
      activePlaybackRange,
      autoPlay,
      clearBuffering,
      durationHint,
      initialTime,
      playbackRate,
      playInternal,
      syncBuffered,
    ],
  )
}

function loadMetadata({
  videoRef,
  activePlaybackRange,
  durationHint,
  playbackRate,
  initialTime,
  autoPlay,
  clearBuffering,
  setDuration,
  setBufferedEnd,
  setStatus,
  volumeRef,
  mutedRef,
  resumeRef,
  lastTimeRef,
  setCurrentTime,
  playInternal,
  syncBuffered,
}: VideoPlayerEventsOptions) {
  const element = videoRef.current
  if (!element) return
  const mediaDuration = finiteMediaDuration(element.duration)
  const nextDuration = playbackDuration(
    mediaDuration,
    activePlaybackRange,
    durationHint,
  )
  setDuration(nextDuration)
  setBufferedEnd(0)
  element.volume = volumeRef.current
  element.muted = mutedRef.current
  element.playbackRate = playbackRate
  setStatus({ kind: "ready" })
  clearBuffering()

  const resume = resumeRef.current
  resumeRef.current = null
  if (resume) {
    const target =
      nextDuration > 0 ? Math.min(resume.time, nextDuration) : resume.time
    try {
      element.currentTime = toMediaTime(
        target,
        mediaDuration,
        activePlaybackRange,
        durationHint,
      )
    } catch {
      // Seeking can throw before the element has a seekable range.
    }
    lastTimeRef.current = target
    setCurrentTime(target)
    if (resume.play) void playInternal(false)
    syncBuffered()
    return
  }

  const target = toPlaybackTime(initialTime, nextDuration, undefined)
  const mediaTarget = toMediaTime(
    target,
    mediaDuration,
    activePlaybackRange,
    durationHint,
  )
  if (element.currentTime !== mediaTarget) element.currentTime = mediaTarget
  lastTimeRef.current = target
  setCurrentTime(target)
  if (autoPlay) void playInternal(false)
  syncBuffered()
}

function useMediaSourceLifecycle(
  options: VideoPlayerEventsOptions,
  { handleLoadedMetadata, handleLoadedData }: LoadedHandlers,
) {
  const {
    autoPlay,
    clearBuffering,
    clearChromeHideTimer,
    identity,
    isCoarsePointer,
    mediaKey,
    prevSourceRef,
    setBufferedEnd,
    setChromeVisible,
    setCurrentTime,
    setDuration,
    setHasRenderedFrame,
    setPlayingState,
    setStatus,
    playRequestIdRef,
    hasRenderedFrameRef,
    lastTimeRef,
    playingRef,
    rangeEndedRef,
    resumeRef,
    videoRef,
  } = options
  useEffect(() => {
    const previous = prevSourceRef.current
    const isNewMedia = !previous || previous.identity !== identity
    const isElementReload = !previous || previous.mediaKey !== mediaKey
    if (!isNewMedia && !isElementReload) return
    prevSourceRef.current = { identity, mediaKey }

    if (isElementReload) {
      playRequestIdRef.current += 1
      setStatus({ kind: "loading" })
      setBufferedEnd(0)
      hasRenderedFrameRef.current = false
      setHasRenderedFrame(false)
    }
    clearBuffering()
    clearChromeHideTimer()
    setChromeVisible(!(isCoarsePointer && autoPlay))

    if (isNewMedia) {
      resumeRef.current = null
      lastTimeRef.current = 0
      setDuration(0)
      setCurrentTime(0)
      setPlayingState(false)
      rangeEndedRef.current = false
    } else {
      resumeRef.current = {
        time: lastTimeRef.current,
        play: playingRef.current,
      }
    }

    if (!isElementReload) return
    const video = videoRef.current
    if (!video) return
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA)
      handleLoadedMetadata()
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
      handleLoadedData()
  }, [
    autoPlay,
    clearBuffering,
    clearChromeHideTimer,
    handleLoadedData,
    handleLoadedMetadata,
    identity,
    isCoarsePointer,
    mediaKey,
    setPlayingState,
  ])
}

function useTimeUpdate({
  activePlaybackRange,
  durationHint,
  loop,
  playInternal,
  rangeEndedRef,
  setPlayingState,
  syncBuffered,
  syncTime,
  videoRef,
  onEndedRef,
}: VideoPlayerEventsOptions) {
  return useCallback(() => {
    syncTime()
    syncBuffered()
    const video = videoRef.current
    if (!video || !activePlaybackRange || rangeEndedRef.current) return
    const mediaDuration = finiteMediaDuration(video.duration)
    const duration = playbackDuration(
      mediaDuration,
      activePlaybackRange,
      durationHint,
    )
    const current = toPlaybackTime(
      video.currentTime || 0,
      mediaDuration,
      activePlaybackRange,
      durationHint,
    )
    if (!(duration > 0) || current < duration - 0.01) return

    rangeEndedRef.current = true
    if (loop) {
      video.currentTime = toMediaTime(
        0,
        mediaDuration,
        activePlaybackRange,
        durationHint,
      )
      rangeEndedRef.current = false
      void playInternal(false)
      return
    }
    video.pause()
    setPlayingState(false)
    onEndedRef.current?.()
  }, [
    activePlaybackRange,
    durationHint,
    loop,
    playInternal,
    setPlayingState,
    syncBuffered,
    syncTime,
  ])
}

function usePlaying(
  { clearBuffering, videoRef }: VideoPlayerEventsOptions,
  handleLoadedData: () => void,
) {
  return useCallback(() => {
    clearBuffering()
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    handleLoadedData()
  }, [clearBuffering, handleLoadedData])
}

function useEnded({
  activePlaybackRange,
  loop,
  onEndedRef,
  playInternal,
  rangeEndedRef,
  setPlayingState,
  syncTime,
}: VideoPlayerEventsOptions) {
  return useCallback(() => {
    setPlayingState(false)
    syncTime()
    if (activePlaybackRange && loop) {
      rangeEndedRef.current = false
      void playInternal(false)
      return
    }
    if (rangeEndedRef.current) return
    rangeEndedRef.current = true
    onEndedRef.current?.()
  }, [activePlaybackRange, loop, playInternal, setPlayingState, syncTime])
}
