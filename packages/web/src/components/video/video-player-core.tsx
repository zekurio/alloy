import { t } from "@alloy/i18n"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { MouseEventHandler } from "react"
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"

import { errorMessage } from "@/lib/error-message"
import { usePlayerVolume } from "@/lib/player-volume"
import { teardownVideoElement } from "@/lib/video-events"

import { useMediaEngine } from "./video-media-engine"
import { useActiveVideoPlayer } from "./video-player-active"
import { useVideoPlayerControls } from "./video-player-controls"
import {
  usePlaybackEnd,
  useRenderedFrame,
  useSourceLoading,
} from "./video-player-core-events"
import {
  useControlledVideoClick,
  useVideoChromePointerHandlers,
} from "./video-player-core-interactions"
import type { PlayerCoreProps } from "./video-player-core-types"
import {
  useFrameLoop,
  useFullscreenContainer,
  usePlayThreshold,
  useVideoChromeVisibility,
} from "./video-player-hooks"
import {
  BareShell,
  ChromeBar,
  ChromeShell,
  LoadOverlay,
} from "./video-player-shell"
import { createPlayerStore, PlayerStoreProvider } from "./video-player-store"
import { readPlaybackClock } from "./video-player-timeline"
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
  playbackRange,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
}: PlayerCoreProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [store] = useState(createPlayerStore)
  const {
    src: mediaUrl,
    mediaKey,
    onMediaError,
    switchingRendition,
  } = useMediaEngine(spec, videoRef, renditionPlayback, playbackRange)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fullscreenContainer = useFullscreenContainer(containerRef)
  const isFullscreen = fullscreenContainer !== null
  const { volume, muted } = usePlayerVolume()
  const playRequestIdRef = useRef(0)
  const rangeEndedRef = useRef(false)
  const bufferingTimerRef = useRef<number | null>(null)

  // The clock (currentTime, duration, bufferedEnd), chrome visibility and
  // playback rate are read by the chrome bar itself, so ticking them doesn't
  // re-render the player.
  const { status, buffering, playing, hasRenderedFrame, posterHeld } = useStore(
    store,
    useShallow((state) => ({
      status: state.status,
      buffering: state.buffering,
      playing: state.playing,
      hasRenderedFrame: state.hasRenderedFrame,
      posterHeld: state.posterHeld,
    })),
  )
  const markFrameRendered = useRenderedFrame(store, onFrameReady)
  const isCoarsePointer = useMediaQuery("(pointer: coarse)")

  const { setChromeVisible, scheduleChromeHide, clearChromeHideTimer } =
    useVideoChromeVisibility(store, isCoarsePointer)

  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onPlayingChangeRef = useRef(onPlayingChange)
  const onPlaybackErrorRef = useRef(onPlaybackError)

  useEffect(() => {
    const video = videoRef.current
    return () => {
      // Keep connected nodes alive during StrictMode effect replay.
      if (video && !video.isConnected) teardownVideoElement(video)
    }
  }, [controls])

  // A hidden <Activity>, like the page kept under the upload editor, leaves
  // the element mounted with display: none, which doesn't stop playback.
  // Hiding runs layout-effect cleanups, so pause here. Only while playing:
  // pausing a video that hasn't started yet (StrictMode's mount replay)
  // would cancel its autoplay. Keyed on `controls` like the teardown above,
  // since switching shells remounts the element.
  useLayoutEffect(() => {
    const video = videoRef.current
    return () => {
      if (video && !video.paused) video.pause()
    }
  }, [controls])

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate
    onPlayingChangeRef.current = onPlayingChange
    onPlaybackErrorRef.current = onPlaybackError
  }, [onTimeUpdate, onPlayingChange, onPlaybackError])

  const readDuration = useCallback(() => {
    const video = videoRef.current
    return video
      ? readPlaybackClock(video, playbackRange, durationHint).duration
      : 0
  }, [playbackRange, durationHint])

  const readCurrentTime = useCallback(() => {
    const video = videoRef.current
    return video
      ? readPlaybackClock(video, playbackRange, durationHint).currentTime
      : 0
  }, [playbackRange, durationHint])

  const checkPlayThreshold = usePlayThreshold({
    identity,
    playbackRange,
    durationHint,
    onPlayThreshold,
  })

  const syncTime = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const nextTime = readCurrentTime()
    store.setState({ currentTime: nextTime, duration: readDuration() })
    onTimeUpdateRef.current?.(nextTime)
    checkPlayThreshold(video)
  }, [checkPlayThreshold, readCurrentTime, readDuration, store])

  const syncBuffered = useCallback(() => {
    const video = videoRef.current
    if (!video || video.buffered.length === 0) {
      store.setState({ bufferedEnd: 0 })
      return
    }
    store.setState({
      bufferedEnd: readPlaybackClock(
        video,
        playbackRange,
        durationHint,
      ).toPlaybackTime(video.buffered.end(video.buffered.length - 1)),
    })
  }, [playbackRange, durationHint, store])

  const clearBuffering = useCallback(() => {
    if (bufferingTimerRef.current !== null) {
      window.clearTimeout(bufferingTimerRef.current)
      bufferingTimerRef.current = null
    }
    store.setState({ buffering: false })
  }, [store])

  // `waiting`/`stalled` fire spuriously while paused and on keyframe-aligned
  // seeks; only a stall during intended playback should surface the spinner,
  // and only after a short debounce so brief buffer refills don't flicker it.
  const handleWaiting = useCallback(() => {
    const video = videoRef.current
    if (!video || video.paused) return
    if (bufferingTimerRef.current !== null) return
    bufferingTimerRef.current = window.setTimeout(() => {
      bufferingTimerRef.current = null
      store.setState({ buffering: true })
    }, 200)
  }, [store])

  useEffect(() => {
    return () => {
      if (bufferingTimerRef.current !== null)
        window.clearTimeout(bufferingTimerRef.current)
    }
  }, [])

  const setPlayingState = useCallback(
    (next: boolean) => {
      if (store.getState().playing === next) return
      store.setState(
        next ? { playing: true, posterHeld: false } : { playing: false },
      )
      onPlayingChangeRef.current?.(next)
    },
    [store],
  )

  const reportError = useCallback(() => {
    // The engine may recover by stepping down one playable quality tier;
    // the media key change resets load state.
    syncTime()
    if (onMediaError()) return
    const video = videoRef.current
    const message = mediaErrorMessage(video)
    clearBuffering()
    setPlayingState(false)
    if (onPlaybackErrorRef.current) {
      store.setState({ status: { kind: "ready" } })
      onPlaybackErrorRef.current(message)
    } else {
      store.setState({ status: { kind: "error", message } })
    }
  }, [clearBuffering, onMediaError, setPlayingState, store, syncTime])

  const playInternal = useCallback(
    async (reportBlocked = true) => {
      const video = videoRef.current
      if (!video) return
      const clock = readPlaybackClock(video, playbackRange, durationHint)
      if (clock.duration > 0 && clock.currentTime >= clock.duration - 0.01) {
        video.currentTime = clock.toMediaTime(0)
        store.setState({ currentTime: 0 })
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
          store.setState({ status: { kind: "ready" } })
          onPlaybackErrorRef.current(message)
        } else {
          store.setState({ status: { kind: "error", message } })
        }
      }
    },
    [playbackRange, durationHint, store],
  )

  const pauseInternal = useCallback(() => {
    playRequestIdRef.current += 1
    videoRef.current?.pause()
  }, [])

  const seekInternal = useCallback(
    (targetSec: number, keepPlaying: boolean = store.getState().playing) => {
      const video = videoRef.current
      if (!video) return
      const clock = readPlaybackClock(video, playbackRange, durationHint)
      const dur = clock.duration
      const min = Math.max(0, shortcutBounds?.start ?? 0)
      const max = Math.max(
        min,
        Math.min(dur > 0 ? dur : targetSec, shortcutBounds?.end ?? dur),
      )
      const clamped = Math.max(
        min,
        Math.min(max, Number.isFinite(targetSec) ? targetSec : 0),
      )
      video.currentTime = clock.toMediaTime(clamped)
      rangeEndedRef.current = dur > 0 && clamped >= dur - 0.01
      store.setState({ posterHeld: false, currentTime: clamped })
      onTimeUpdateRef.current?.(clamped)
      if (keepPlaying) void playInternal()
    },
    [
      durationHint,
      playbackRange,
      playInternal,
      shortcutBounds?.end,
      shortcutBounds?.start,
      store,
    ],
  )

  // Volume changes from other players or tabs land through the shared store.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [muted, volume])

  useFrameLoop(playing, syncTime)

  const {
    keyCommand,
    setPlaybackRate,
    setVolume,
    finishVolumeChange,
    toggleFullscreen,
    toggleMute,
    togglePlay,
  } = useVideoPlayerControls({
    store,
    containerRef,
    getCurrentTime: readCurrentTime,
    getDuration: readDuration,
    isCoarsePointer,
    pauseInternal,
    playerRef,
    playInternal,
    seekInternal,
    setChromeVisible,
    shortcutBounds,
    videoRef,
  })

  const { activatePlayer, focusPlayerContainer } = useActiveVideoPlayer({
    autoPlay,
    controls,
    containerRef,
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
    setChromeVisible,
  ])

  const handleLoadedMetadata = useSourceLoading({
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
  })
  const { handleTimeUpdate, handleEnded } = usePlaybackEnd({
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
  })
  const {
    handlePointerMove: handleChromePointerMove,
    handlePointerLeave: handleChromePointerLeave,
  } = useVideoChromePointerHandlers({
    store,
    clearChromeHideTimer,
    isCoarsePointer,
    scheduleChromeHide,
    setChromeVisible,
  })

  const handleControlledVideoClick = useControlledVideoClick({
    store,
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
      posterVisible={Boolean(poster) && (posterHeld || !hasRenderedFrame)}
      autoPlay={autoPlay}
      loop={loop && !playbackRange}
      muted={muted}
      onPointerDown={focusPlayerContainer}
      onClick={clickHandler}
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={markFrameRendered}
      onCanPlay={() => {
        markFrameRendered()
        clearBuffering()
      }}
      onWaiting={handleWaiting}
      onStalled={handleWaiting}
      onPlaying={(event) => {
        clearBuffering()
        if (
          event.currentTarget.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        )
          markFrameRendered()
      }}
      onDurationChange={syncTime}
      onTimeUpdate={handleTimeUpdate}
      onProgress={syncBuffered}
      onPlay={() => setPlayingState(true)}
      onPause={() => {
        setPlayingState(false)
        clearBuffering()
        syncTime()
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
    <PlayerStoreProvider value={store}>
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
        isFullscreen={isFullscreen}
        onKeyCommand={keyCommand}
        enableHorizontalSeekShortcuts={enableHorizontalSeekShortcuts}
        bar={
          <ChromeBar
            containerRef={containerRef}
            fullscreenContainer={fullscreenContainer}
            isCoarsePointer={isCoarsePointer}
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
            onSelectQuality={(id) => {
              syncTime()
              onSelectQuality?.(id)
            }}
            onPlaybackRateChange={setPlaybackRate}
          />
        }
      >
        {renderVideo(handleControlledVideoClick)}

        <LoadOverlay
          status={status}
          buffering={buffering || switchingRendition}
          loadingLabel={
            switchingRendition ? t("Loading quality...") : undefined
          }
        />
      </ChromeShell>
    </PlayerStoreProvider>
  )
}
