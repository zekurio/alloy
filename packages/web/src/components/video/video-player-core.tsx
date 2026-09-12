import { t } from "@alloy/i18n"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import { useCallback, useEffect, useRef, useState } from "react"
import type { MouseEventHandler } from "react"

import { suspendBackgroundMediaWork } from "@/lib/background-media-work"
import { errorMessage } from "@/lib/error-message"
import { usePlayerVolume } from "@/lib/player-volume"
import { teardownVideoElement } from "@/lib/video-events"

import { useMediaEngine } from "./video-media-engine"
import { useActiveVideoPlayer } from "./video-player-active"
import { useVideoPlayerControls } from "./video-player-controls"
import { useVideoPlayerEvents } from "./video-player-core-events"
import {
  useControlledVideoClick,
  useVideoChromePointerHandlers,
} from "./video-player-core-interactions"
import type { PlayerCoreProps } from "./video-player-core-types"
import {
  usePlayingTimeSync,
  usePlayThreshold,
  useVideoChromeVisibility,
} from "./video-player-hooks"
import {
  BareShell,
  ChromeBar,
  ChromeShell,
  LoadOverlay,
  type LoadStatus,
} from "./video-player-shell"
import {
  finiteMediaDuration,
  playbackDuration,
  toMediaTime,
  toPlaybackTime,
} from "./video-player-timeline"
import { VideoFrame } from "./video-player-video"
import { isInterruptedPlayRequest, mediaErrorMessage } from "./video-source"

export function PlayerCore({
  spec,
  renditionPlayback,
  identity,
  poster,
  posterBlurHash,
  fallbackSeed,
  aspectRatio,
  controls,
  autoPlay,
  loop,
  initialMuted,
  initialTime,
  className,
  maxDisplayHeight,
  durationHint,
  playerRef,
  onTimeUpdate,
  onPlayingChange,
  onVideoClick,
  onPlaybackError,
  onPlayThreshold,
  onFrameReady,
  onEnded,
  chromeSize = "default",
  shortcutBounds,
  enableHorizontalSeekShortcuts = true,
  playbackRate,
  playbackRange,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
}: PlayerCoreProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const {
    src: mediaUrl,
    mediaKey,
    activePlaybackRange,
    onMediaError,
    switchingRendition,
  } = useMediaEngine(spec, videoRef, renditionPlayback, playbackRange)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerVolume = usePlayerVolume()
  const initialPlayerVolumeRef = useRef(playerVolume)
  const playingRef = useRef(false)
  const volumeRef = useRef(playerVolume.volume)
  const mutedRef = useRef(initialMuted || playerVolume.muted)
  const initialMutedPropRef = useRef(initialMuted)
  const lastTimeRef = useRef(0)
  const playRequestIdRef = useRef(0)
  const hasRenderedFrameRef = useRef(false)
  const rangeEndedRef = useRef(false)
  const resumeRef = useRef<{ time: number; play: boolean } | null>(null)
  const prevSourceRef = useRef<{
    identity: string
    mediaKey: string
  } | null>(null)

  const [status, setStatus] = useState<LoadStatus>({ kind: "loading" })
  const [buffering, setBuffering] = useState(false)
  const bufferingTimerRef = useRef<number | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolumeState] = useState(playerVolume.volume)
  const [muted, setMutedState] = useState(initialMuted || playerVolume.muted)
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false)
  const isCoarsePointer = useMediaQuery("(pointer: coarse)")

  const {
    chromeVisible,
    setChromeVisible,
    scheduleChromeHide,
    clearChromeHideTimer,
  } = useVideoChromeVisibility(isCoarsePointer)

  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onPlayingChangeRef = useRef(onPlayingChange)
  const onPlaybackErrorRef = useRef(onPlaybackError)
  const onFrameReadyRef = useRef(onFrameReady)
  const onEndedRef = useRef(onEnded)

  useEffect(() => {
    const video = videoRef.current
    return () => {
      // Keep connected nodes alive during StrictMode effect replay.
      if (video && !video.isConnected) teardownVideoElement(video)
    }
  }, [controls])

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate
    onPlayingChangeRef.current = onPlayingChange
    onPlaybackErrorRef.current = onPlaybackError
    onFrameReadyRef.current = onFrameReady
    onEndedRef.current = onEnded
  }, [onTimeUpdate, onPlayingChange, onPlaybackError, onFrameReady, onEnded])

  const readDuration = useCallback(() => {
    const video = videoRef.current
    return video
      ? playbackDuration(
          finiteMediaDuration(video.duration),
          activePlaybackRange,
          durationHint,
        )
      : 0
  }, [activePlaybackRange, durationHint])

  const readCurrentTime = useCallback(() => {
    const video = videoRef.current
    return video
      ? toPlaybackTime(
          video.currentTime || 0,
          finiteMediaDuration(video.duration),
          activePlaybackRange,
          durationHint,
        )
      : 0
  }, [activePlaybackRange, durationHint])

  const syncTime = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const nextDuration = readDuration()
    const nextTime = readCurrentTime()
    lastTimeRef.current = nextTime
    setCurrentTime(nextTime)
    setDuration(nextDuration)
    onTimeUpdateRef.current?.(nextTime)
  }, [readCurrentTime, readDuration])

  const syncBuffered = useCallback(() => {
    const video = videoRef.current
    if (!video || video.buffered.length === 0) {
      setBufferedEnd(0)
      return
    }
    setBufferedEnd(
      toPlaybackTime(
        video.buffered.end(video.buffered.length - 1),
        finiteMediaDuration(video.duration),
        activePlaybackRange,
        durationHint,
      ),
    )
  }, [activePlaybackRange, durationHint])

  const clearBuffering = useCallback(() => {
    if (bufferingTimerRef.current !== null) {
      window.clearTimeout(bufferingTimerRef.current)
      bufferingTimerRef.current = null
    }
    setBuffering(false)
  }, [])

  // `waiting`/`stalled` fire spuriously while paused and on keyframe-aligned
  // seeks; only a stall during intended playback should surface the spinner,
  // and only after a short debounce so brief buffer refills don't flicker it.
  const handleWaiting = useCallback(() => {
    const video = videoRef.current
    if (!video || video.paused) return
    if (bufferingTimerRef.current !== null) return
    bufferingTimerRef.current = window.setTimeout(() => {
      bufferingTimerRef.current = null
      setBuffering(true)
    }, 200)
  }, [])

  useEffect(() => {
    return () => {
      if (bufferingTimerRef.current !== null)
        window.clearTimeout(bufferingTimerRef.current)
    }
  }, [])

  const setPlayingState = useCallback((next: boolean) => {
    if (playingRef.current === next) return
    playingRef.current = next
    setPlaying(next)
    onPlayingChangeRef.current?.(next)
  }, [])

  const reportError = useCallback(() => {
    // The engine may recover by stepping down one playable quality tier;
    // the media key change resets load state.
    if (onMediaError()) return
    const video = videoRef.current
    const message = mediaErrorMessage(video)
    clearBuffering()
    setPlayingState(false)
    if (onPlaybackErrorRef.current) {
      setStatus({ kind: "ready" })
      onPlaybackErrorRef.current(message)
    } else {
      setStatus({ kind: "error", message })
    }
  }, [clearBuffering, onMediaError, setPlayingState])

  const playInternal = useCallback(
    async (reportBlocked = true) => {
      const video = videoRef.current
      if (!video) return
      const mediaDuration = finiteMediaDuration(video.duration)
      const duration = playbackDuration(
        mediaDuration,
        activePlaybackRange,
        durationHint,
      )
      const currentTime = toPlaybackTime(
        video.currentTime || 0,
        mediaDuration,
        activePlaybackRange,
        durationHint,
      )
      if (duration > 0 && currentTime >= duration - 0.01) {
        video.currentTime = toMediaTime(
          0,
          mediaDuration,
          activePlaybackRange,
          durationHint,
        )
        lastTimeRef.current = 0
        setCurrentTime(0)
      }
      rangeEndedRef.current = false
      const requestId = playRequestIdRef.current + 1
      playRequestIdRef.current = requestId
      try {
        await video.play()
      } catch (err) {
        if (
          requestId !== playRequestIdRef.current ||
          isInterruptedPlayRequest(err)
        ) {
          return
        }
        if (!reportBlocked) return
        const message = errorMessage(err, t("Playback failed"))
        if (onPlaybackErrorRef.current) {
          setStatus({ kind: "ready" })
          onPlaybackErrorRef.current(message)
        } else {
          setStatus({ kind: "error", message })
        }
      }
    },
    [activePlaybackRange, durationHint],
  )

  const pauseInternal = useCallback(() => {
    playRequestIdRef.current += 1
    videoRef.current?.pause()
  }, [])

  const seekInternal = useCallback(
    (targetSec: number, keepPlaying: boolean = playingRef.current) => {
      const video = videoRef.current
      if (!video) return
      const dur = playbackDuration(
        finiteMediaDuration(video.duration),
        activePlaybackRange,
        durationHint,
      )
      const min = Math.max(0, shortcutBounds?.start ?? 0)
      const max = Math.max(
        min,
        Math.min(dur > 0 ? dur : targetSec, shortcutBounds?.end ?? dur),
      )
      const clamped = Math.max(
        min,
        Math.min(max, Number.isFinite(targetSec) ? targetSec : 0),
      )
      video.currentTime = toMediaTime(
        clamped,
        finiteMediaDuration(video.duration),
        activePlaybackRange,
        durationHint,
      )
      rangeEndedRef.current = dur > 0 && clamped >= dur - 0.01
      setCurrentTime(clamped)
      onTimeUpdateRef.current?.(clamped)
      if (keepPlaying) void playInternal()
    },
    [
      activePlaybackRange,
      durationHint,
      playInternal,
      shortcutBounds?.end,
      shortcutBounds?.start,
    ],
  )

  useEffect(() => {
    if (initialMutedPropRef.current === initialMuted) return
    initialMutedPropRef.current = initialMuted
    mutedRef.current = initialMuted
    setMutedState(initialMuted)
    const video = videoRef.current
    if (video) video.muted = initialMuted
  }, [initialMuted])

  useEffect(() => {
    if (initialPlayerVolumeRef.current === playerVolume) return
    volumeRef.current = playerVolume.volume
    mutedRef.current = playerVolume.muted
    setVolumeState(playerVolume.volume)
    setMutedState(playerVolume.muted)
    const video = videoRef.current
    if (!video) return
    video.volume = playerVolume.volume
    video.muted = playerVolume.muted
  }, [playerVolume])

  useEffect(() => {
    volumeRef.current = volume
    mutedRef.current = muted
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [muted, volume])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = playbackRate
  }, [playbackRate])

  usePlayingTimeSync(playing, syncTime)

  useEffect(() => {
    if (!playing) return
    return suspendBackgroundMediaWork()
  }, [playing])

  const {
    keyCommand,
    setVolume,
    finishVolumeChange,
    toggleFullscreen,
    toggleMute,
    togglePlay,
  } = useVideoPlayerControls({
    containerRef,
    duration,
    getCurrentTime: readCurrentTime,
    getDuration: readDuration,
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
  })

  const { activatePlayer, focusPlayerContainer } = useActiveVideoPlayer({
    autoPlay,
    controls,
    containerRef,
    clearChromeHideTimer,
    enableHorizontalSeekShortcuts,
    keyCommand,
  })

  useEffect(() => {
    if (isCoarsePointer && autoPlay) {
      clearChromeHideTimer()
      setChromeVisible(false)
      return
    }
    if (playing) {
      scheduleChromeHide()
    } else {
      clearChromeHideTimer()
      if (!isCoarsePointer) setChromeVisible(true)
    }
  }, [
    autoPlay,
    clearChromeHideTimer,
    isCoarsePointer,
    playing,
    scheduleChromeHide,
  ])

  usePlayThreshold({
    playing,
    duration,
    identity,
    onPlayThreshold,
  })

  const {
    handleLoadedMetadata,
    handleLoadedData,
    handleCanPlay,
    handleTimeUpdate,
    handlePlaying,
    handleEnded,
  } = useVideoPlayerEvents({
    videoRef,
    identity,
    mediaKey,
    activePlaybackRange,
    durationHint,
    playbackRate,
    initialTime,
    autoPlay,
    loop,
    isCoarsePointer,
    clearBuffering,
    clearChromeHideTimer,
    setChromeVisible,
    setStatus,
    setDuration,
    setCurrentTime,
    setBufferedEnd,
    setHasRenderedFrame,
    setPlayingState,
    syncBuffered,
    syncTime,
    playInternal,
    volumeRef,
    mutedRef,
    playingRef,
    lastTimeRef,
    playRequestIdRef,
    hasRenderedFrameRef,
    rangeEndedRef,
    resumeRef,
    prevSourceRef,
    onFrameReadyRef,
    onEndedRef,
  })
  const {
    handlePointerMove: handleChromePointerMove,
    handlePointerLeave: handleChromePointerLeave,
  } = useVideoChromePointerHandlers({
    clearChromeHideTimer,
    isCoarsePointer,
    playingRef,
    scheduleChromeHide,
    setChromeVisible,
  })

  const handleControlledVideoClick = useControlledVideoClick({
    clearChromeHideTimer,
    isCoarsePointer,
    onVideoClick,
    scheduleChromeHide,
    setChromeVisible,
    togglePlay,
  })

  const renderVideo = (clickHandler?: MouseEventHandler<HTMLVideoElement>) => (
    <VideoFrame
      videoRef={videoRef}
      mediaUrl={mediaUrl}
      poster={poster}
      posterBlurHash={posterBlurHash}
      fallbackSeed={fallbackSeed ?? identity}
      aspectRatio={aspectRatio}
      placeholderVisible={!hasRenderedFrame}
      posterVisible={Boolean(poster) && !hasRenderedFrame}
      autoPlay={autoPlay}
      loop={loop && !activePlaybackRange}
      muted={muted}
      onPointerDown={focusPlayerContainer}
      onClick={clickHandler}
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={handleLoadedData}
      onCanPlay={handleCanPlay}
      onWaiting={handleWaiting}
      onStalled={handleWaiting}
      onPlaying={handlePlaying}
      onDurationChange={syncTime}
      onTimeUpdate={handleTimeUpdate}
      onProgress={syncBuffered}
      onPlay={() => setPlayingState(true)}
      onPause={() => {
        setPlayingState(false)
        clearBuffering()
      }}
      onEnded={handleEnded}
      onError={reportError}
    />
  )

  if (!controls) {
    return (
      <BareShell
        containerRef={containerRef}
        className={className}
        status={status}
        buffering={buffering || switchingRendition}
        loadingLabel={switchingRendition ? t("Loading quality...") : undefined}
        aspectRatio={aspectRatio}
        maxDisplayHeight={maxDisplayHeight}
        onPointerDown={activatePlayer}
        onFocus={activatePlayer}
      >
        {renderVideo(onVideoClick)}
      </BareShell>
    )
  }

  return (
    <ChromeShell
      containerRef={containerRef}
      className={className}
      aspectRatio={aspectRatio}
      maxDisplayHeight={maxDisplayHeight}
      playing={playing}
      onPointerDown={activatePlayer}
      onPointerMove={handleChromePointerMove}
      onPointerLeave={handleChromePointerLeave}
      onFocus={activatePlayer}
      onKeyCommand={keyCommand}
      enableHorizontalSeekShortcuts={enableHorizontalSeekShortcuts}
      bar={
        <ChromeBar
          containerRef={containerRef}
          playing={playing}
          duration={duration}
          currentTime={currentTime}
          bufferedEnd={bufferedEnd}
          visible={chromeVisible}
          muted={muted}
          volume={volume}
          size={chromeSize}
          onTogglePlay={togglePlay}
          onToggleMute={toggleMute}
          onVolumeChange={setVolume}
          onVolumeChangeEnd={finishVolumeChange}
          onSeek={(seconds) => seekInternal(seconds)}
          onToggleFullscreen={toggleFullscreen}
          qualityOptions={qualityOptions}
          selectedQualityId={selectedQualityId}
          onSelectQuality={onSelectQuality}
        />
      }
    >
      {renderVideo(handleControlledVideoClick)}

      <LoadOverlay
        status={status}
        buffering={buffering || switchingRendition}
        loadingLabel={switchingRendition ? t("Loading quality...") : undefined}
      />
    </ChromeShell>
  )
}
