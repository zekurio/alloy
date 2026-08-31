import { t } from "@alloy/i18n"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import { useCallback, useEffect, useRef, useState } from "react"
import type { MouseEvent, MouseEventHandler } from "react"

import { suspendBackgroundMediaWork } from "@/lib/background-media-work"
import { errorMessage } from "@/lib/error-message"
import { usePlayerVolume } from "@/lib/player-volume"

import { useAudioTrackMixerEngine } from "./audio-track-mixer-engine"
import { useMediaEngine } from "./video-media-engine"
import { useActiveVideoPlayer } from "./video-player-active"
import { useVideoPlayerControls } from "./video-player-controls"
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
  audioMixer,
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

  const audioMixerEngine = useAudioTrackMixerEngine({
    mixer: audioMixer,
    videoRef,
    volume,
    muted,
  })
  const audioMixerEngaged = audioMixerEngine.engaged
  const audioMixerEngagedRef = audioMixerEngine.engagedRef

  useEffect(() => {
    if (initialMutedPropRef.current === initialMuted) return
    initialMutedPropRef.current = initialMuted
    mutedRef.current = initialMuted
    setMutedState(initialMuted)
    const video = videoRef.current
    if (video) video.muted = initialMuted || audioMixerEngagedRef.current
  }, [audioMixerEngagedRef, initialMuted])

  useEffect(() => {
    if (initialPlayerVolumeRef.current === playerVolume) return
    volumeRef.current = playerVolume.volume
    mutedRef.current = playerVolume.muted
    setVolumeState(playerVolume.volume)
    setMutedState(playerVolume.muted)
    const video = videoRef.current
    if (!video) return
    video.volume = playerVolume.volume
    video.muted = playerVolume.muted || audioMixerEngagedRef.current
  }, [audioMixerEngagedRef, playerVolume])

  useEffect(() => {
    volumeRef.current = volume
    mutedRef.current = muted
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted || audioMixerEngaged
  }, [audioMixerEngaged, muted, volume])

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
    audioMixerEngagedRef,
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

  const handleLoadedMetadata = useCallback(() => {
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
    element.muted = mutedRef.current || audioMixerEngagedRef.current
    element.playbackRate = playbackRate
    setStatus({ kind: "ready" })
    clearBuffering()

    const resume = resumeRef.current
    resumeRef.current = null
    if (resume) {
      // Restore the position from before a quality switch, then continue
      // playing if the viewer was. The poster stays up until the seeked frame
      // decodes, so there is no black flash.
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
        // Seeking can throw if the element is not yet seekable; the timeupdate
        // loop will reconcile the scrubber regardless.
      }
      lastTimeRef.current = target
      setCurrentTime(target)
      if (resume.play) void playInternal(false)
    } else {
      const target = toMediaTime(
        0,
        mediaDuration,
        activePlaybackRange,
        durationHint,
      )
      if (element.currentTime !== target) element.currentTime = target
      lastTimeRef.current = 0
      setCurrentTime(0)
      if (autoPlay) void playInternal(false)
    }
    syncBuffered()
  }, [
    audioMixerEngagedRef,
    activePlaybackRange,
    autoPlay,
    clearBuffering,
    durationHint,
    playbackRate,
    playInternal,
    syncBuffered,
  ])

  const handleLoadedData = useCallback(() => {
    if (hasRenderedFrameRef.current) return
    hasRenderedFrameRef.current = true
    setHasRenderedFrame(true)
    onFrameReadyRef.current?.()
  }, [])

  const handleCanPlay = useCallback(() => {
    handleLoadedData()
    clearBuffering()
  }, [clearBuffering, handleLoadedData])

  useEffect(() => {
    // A changed `identity` means a different clip. A changed media key with
    // the same identity is a source swap for the same clip (e.g. a quality
    // switch or an automatic downgrade).
    const previous = prevSourceRef.current
    const isNewMedia = !previous || previous.identity !== identity
    // Load state only resets when the element will actually reload (a new
    // effective media URL). An identity change with an unchanged URL never
    // re-fires `loadedmetadata`, so entering "loading" there would strand the
    // spinner over a playing video.
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
      // Brand-new clip: start from the beginning.
      resumeRef.current = null
      lastTimeRef.current = 0
      setDuration(0)
      setCurrentTime(0)
      setPlayingState(false)
      rangeEndedRef.current = false
    } else {
      // Same clip, different source: resume where the viewer was. Capture
      // the position/playing state now, before the element load resets them,
      // and leave the scrubber untouched so the UI doesn't jump to zero.
      resumeRef.current = {
        time: lastTimeRef.current,
        play: playingRef.current,
      }
    }

    if (!isElementReload) return
    const video = videoRef.current
    if (!video) return
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      handleLoadedMetadata()
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      handleLoadedData()
    }
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

  const posterVisible = Boolean(poster) && !hasRenderedFrame

  const handleTimeUpdate = useCallback(() => {
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

  const handlePlaying = useCallback(() => {
    clearBuffering()
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    handleLoadedData()
  }, [clearBuffering, handleLoadedData])

  const handleEnded = useCallback(() => {
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

  const handleChromePointerMove = useCallback(() => {
    if (isCoarsePointer) return
    setChromeVisible(true)
    if (playingRef.current) scheduleChromeHide()
  }, [isCoarsePointer, scheduleChromeHide])

  const handleChromePointerLeave = useCallback(() => {
    if (isCoarsePointer) return
    clearChromeHideTimer()
    setChromeVisible(false)
  }, [clearChromeHideTimer, isCoarsePointer])

  const handleControlledVideoClick = useCallback(
    (event: MouseEvent<HTMLVideoElement>) => {
      onVideoClick?.(event)

      if (isCoarsePointer) {
        setChromeVisible((current) => {
          const next = !current
          if (next) scheduleChromeHide()
          else clearChromeHideTimer()
          return next
        })
        return
      }

      setChromeVisible(true)
      togglePlay()
    },
    [
      clearChromeHideTimer,
      isCoarsePointer,
      onVideoClick,
      scheduleChromeHide,
      togglePlay,
    ],
  )

  const renderVideo = (clickHandler?: MouseEventHandler<HTMLVideoElement>) => (
    <VideoFrame
      videoRef={videoRef}
      mediaUrl={mediaUrl}
      poster={poster}
      posterBlurHash={posterBlurHash}
      fallbackSeed={fallbackSeed ?? identity}
      aspectRatio={aspectRatio}
      placeholderVisible={!hasRenderedFrame}
      posterVisible={posterVisible}
      autoPlay={autoPlay}
      loop={loop && !activePlaybackRange}
      muted={muted || audioMixerEngaged}
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
          audioMixer={audioMixer}
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
