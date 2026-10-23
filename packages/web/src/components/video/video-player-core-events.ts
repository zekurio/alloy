import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import type { Dispatch, RefObject, SetStateAction } from "react"

import type { LoadStatus } from "./video-player-shell"
import { readPlaybackClock, toPlaybackTime } from "./video-player-timeline"
import type { MediaPlaybackRange } from "./video-player-types"

type ResumeState = { time: number; play: boolean }
type SourceState = { identity: string; mediaKey: string }

/** Whether the current source has put a frame on screen. */
export function useRenderedFrame(onFrameReady: (() => void) | undefined) {
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false)
  const hasRenderedFrameRef = useRef(false)
  const onFrameReadyRef = useRef(onFrameReady)

  useEffect(() => {
    onFrameReadyRef.current = onFrameReady
  }, [onFrameReady])

  const markFrameRendered = useCallback(() => {
    if (hasRenderedFrameRef.current) return
    hasRenderedFrameRef.current = true
    setHasRenderedFrame(true)
    onFrameReadyRef.current?.()
  }, [])

  const resetRenderedFrame = useCallback(() => {
    hasRenderedFrameRef.current = false
    setHasRenderedFrame(false)
  }, [])

  return { hasRenderedFrame, markFrameRendered, resetRenderedFrame }
}

/**
 * Resets player state when the source changes and applies the start position
 * once metadata loads. A new `identity` starts over from `initialTime`; a new
 * `mediaKey` for the same identity (quality or range switch) reloads the
 * element and resumes where playback was. Returns the `loadedmetadata`
 * handler.
 */
export function useSourceLoading({
  videoRef,
  identity,
  mediaKey,
  playbackRange,
  durationHint,
  playbackRate,
  initialTime,
  autoPlay,
  isCoarsePointer,
  volumeRef,
  mutedRef,
  playingRef,
  lastTimeRef,
  playRequestIdRef,
  rangeEndedRef,
  setStatus,
  setDuration,
  setCurrentTime,
  setBufferedEnd,
  setPlayingState,
  clearBuffering,
  clearChromeHideTimer,
  setChromeVisible,
  syncBuffered,
  playInternal,
  markFrameRendered,
  resetRenderedFrame,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  identity: string
  mediaKey: string
  playbackRange: MediaPlaybackRange | undefined
  durationHint: number | undefined
  playbackRate: number
  initialTime: number
  autoPlay: boolean
  isCoarsePointer: boolean
  volumeRef: RefObject<number>
  mutedRef: RefObject<boolean>
  playingRef: RefObject<boolean>
  lastTimeRef: RefObject<number>
  playRequestIdRef: RefObject<number>
  rangeEndedRef: RefObject<boolean>
  setStatus: Dispatch<SetStateAction<LoadStatus>>
  setDuration: Dispatch<SetStateAction<number>>
  setCurrentTime: Dispatch<SetStateAction<number>>
  setBufferedEnd: Dispatch<SetStateAction<number>>
  setPlayingState: (playing: boolean) => void
  clearBuffering: () => void
  clearChromeHideTimer: () => void
  setChromeVisible: Dispatch<SetStateAction<boolean>>
  syncBuffered: () => void
  playInternal: (reportBlocked?: boolean) => Promise<void>
  markFrameRendered: () => void
  resetRenderedFrame: () => void
}) {
  const resumeRef = useRef<ResumeState | null>(null)
  const prevSourceRef = useRef<SourceState | null>(null)

  const handleLoadedMetadata = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    const clock = readPlaybackClock(element, playbackRange, durationHint)
    const nextDuration = clock.duration
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
        element.currentTime = clock.toMediaTime(target)
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
    const mediaTarget = clock.toMediaTime(target)
    if (element.currentTime !== mediaTarget) element.currentTime = mediaTarget
    lastTimeRef.current = target
    setCurrentTime(target)
    if (autoPlay) void playInternal(false)
    syncBuffered()
  }, [
    autoPlay,
    clearBuffering,
    durationHint,
    initialTime,
    lastTimeRef,
    mutedRef,
    playbackRange,
    playbackRate,
    playInternal,
    setBufferedEnd,
    setCurrentTime,
    setDuration,
    setStatus,
    syncBuffered,
    videoRef,
    volumeRef,
  ])

  const resetForSource = useEffectEvent(
    (isNewMedia: boolean, isElementReload: boolean) => {
      if (isElementReload) {
        playRequestIdRef.current += 1
        setStatus({ kind: "loading" })
        setBufferedEnd(0)
        resetRenderedFrame()
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
