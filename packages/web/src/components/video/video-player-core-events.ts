import { useCallback, useEffect, useEffectEvent, useRef } from "react"
import type { RefObject } from "react"

import { readPlayerVolume } from "@/lib/player-volume"

import type { PlayerStore } from "./video-player-store"
import { readPlaybackClock, toPlaybackTime } from "./video-player-timeline"
import type { MediaPlaybackRange } from "./video-player-types"

type ResumeState = { time: number; play: boolean }
type SourceState = { identity: string; mediaKey: string }

/** Marks the current source's first frame on screen, once per source. */
export function useRenderedFrame(
  store: PlayerStore,
  onFrameReady: (() => void) | undefined,
) {
  const onFrameReadyRef = useRef(onFrameReady)

  useEffect(() => {
    onFrameReadyRef.current = onFrameReady
  }, [onFrameReady])

  return useCallback(() => {
    if (store.getState().hasRenderedFrame) return
    store.setState({ hasRenderedFrame: true })
    onFrameReadyRef.current?.()
  }, [store])
}

/**
 * Resets player state when the source changes and applies the start position
 * once metadata loads. A new `identity` starts over from `initialTime`; a new
 * `mediaKey` for the same identity (quality or range switch) reloads the
 * element and resumes where playback was. Returns the `loadedmetadata`
 * handler.
 */
export function useSourceLoading({
  store,
  videoRef,
  identity,
  mediaKey,
  playbackRange,
  durationHint,
  initialTime,
  autoPlay,
  isCoarsePointer,
  playRequestIdRef,
  rangeEndedRef,
  setPlayingState,
  clearBuffering,
  clearChromeHideTimer,
  syncBuffered,
  playInternal,
  markFrameRendered,
}: {
  store: PlayerStore
  videoRef: RefObject<HTMLVideoElement | null>
  identity: string
  mediaKey: string
  playbackRange: MediaPlaybackRange | undefined
  durationHint: number | undefined
  initialTime: number
  autoPlay: boolean
  isCoarsePointer: boolean
  playRequestIdRef: RefObject<number>
  rangeEndedRef: RefObject<boolean>
  setPlayingState: (playing: boolean) => void
  clearBuffering: () => void
  clearChromeHideTimer: () => void
  syncBuffered: () => void
  playInternal: (reportBlocked?: boolean) => Promise<void>
  markFrameRendered: () => void
}) {
  const resumeRef = useRef<ResumeState | null>(null)
  const prevSourceRef = useRef<SourceState | null>(null)

  const handleLoadedMetadata = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    const clock = readPlaybackClock(element, playbackRange, durationHint)
    const nextDuration = clock.duration
    const { volume, muted } = readPlayerVolume()
    element.volume = volume
    element.muted = muted
    element.playbackRate = store.getState().playbackRate
    store.setState({
      duration: nextDuration,
      bufferedEnd: 0,
      status: { kind: "ready" },
    })
    clearBuffering()

    const resume = resumeRef.current
    resumeRef.current = null
    if (resume) {
      const target =
        nextDuration > 0 ? Math.min(resume.time, nextDuration) : resume.time
      try {
        element.currentTime = clock.toMediaTime(target)
      } catch {
        // Seeking can throw before the element has a seekable range.
      }
      store.setState({ currentTime: target })
      if (resume.play) void playInternal(false)
      syncBuffered()
      return
    }

    const target = toPlaybackTime(initialTime, nextDuration, undefined)
    const mediaTarget = clock.toMediaTime(target)
    if (element.currentTime !== mediaTarget) element.currentTime = mediaTarget
    store.setState({ currentTime: target })
    if (autoPlay) void playInternal(false)
    syncBuffered()
  }, [
    autoPlay,
    clearBuffering,
    durationHint,
    initialTime,
    playbackRange,
    playInternal,
    store,
    syncBuffered,
    videoRef,
  ])

  const resetForSource = useEffectEvent(
    (isNewMedia: boolean, isElementReload: boolean) => {
      if (isElementReload) {
        playRequestIdRef.current += 1
        store.setState({
          status: { kind: "loading" },
          bufferedEnd: 0,
          hasRenderedFrame: false,
        })
      }
      clearBuffering()
      clearChromeHideTimer()
      store.setState({ chromeVisible: !(isCoarsePointer && autoPlay) })

      if (isNewMedia) {
        resumeRef.current = null
        store.setState({ duration: 0, currentTime: 0, posterHeld: true })
        setPlayingState(false)
        rangeEndedRef.current = false
      } else {
        const { currentTime, playing } = store.getState()
        resumeRef.current = { time: currentTime, play: playing }
      }

      if (!isElementReload) return
      const video = videoRef.current
      if (!video) return
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA)
        handleLoadedMetadata()
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
        markFrameRendered()
    },
  )

  useEffect(() => {
    const previous = prevSourceRef.current
    const isNewMedia = !previous || previous.identity !== identity
    const isElementReload = !previous || previous.mediaKey !== mediaKey
    if (!isNewMedia && !isElementReload) return
    prevSourceRef.current = { identity, mediaKey }
    resetForSource(isNewMedia, isElementReload)
  }, [identity, mediaKey])

  return handleLoadedMetadata
}

/**
 * Stops or loops playback at the end of a playback range, which the element
 * does not know about, and reports the end of playback. Returns the
 * `timeupdate` and `ended` handlers.
 */
export function usePlaybackEnd({
  videoRef,
  playbackRange,
  durationHint,
  loop,
  rangeEndedRef,
  setPlayingState,
  syncTime,
  syncBuffered,
  playInternal,
  onEnded,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  playbackRange: MediaPlaybackRange | undefined
  durationHint: number | undefined
  loop: boolean
  rangeEndedRef: RefObject<boolean>
  setPlayingState: (playing: boolean) => void
  syncTime: () => void
  syncBuffered: () => void
  playInternal: (reportBlocked?: boolean) => Promise<void>
  onEnded: (() => void) | undefined
}) {
  const onEndedRef = useRef(onEnded)

  useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  const handleTimeUpdate = useCallback(() => {
    syncTime()
    syncBuffered()
    const video = videoRef.current
    if (!video || !playbackRange || rangeEndedRef.current) return
    const clock = readPlaybackClock(video, playbackRange, durationHint)
    if (!(clock.duration > 0) || clock.currentTime < clock.duration - 0.01)
      return

    rangeEndedRef.current = true
    if (loop) {
      video.currentTime = clock.toMediaTime(0)
      rangeEndedRef.current = false
      void playInternal(false)
      return
    }
    video.pause()
    setPlayingState(false)
    onEndedRef.current?.()
  }, [
    durationHint,
    loop,
    playbackRange,
    playInternal,
    rangeEndedRef,
    setPlayingState,
    syncBuffered,
    syncTime,
    videoRef,
  ])

  const handleEnded = useCallback(() => {
    setPlayingState(false)
    syncTime()
    if (playbackRange && loop) {
      rangeEndedRef.current = false
      void playInternal(false)
      return
    }
    if (rangeEndedRef.current) return
    rangeEndedRef.current = true
    onEndedRef.current?.()
  }, [
    loop,
    playbackRange,
    playInternal,
    rangeEndedRef,
    setPlayingState,
    syncTime,
  ])

  return { handleTimeUpdate, handleEnded }
}
