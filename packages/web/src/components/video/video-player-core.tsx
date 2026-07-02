import { t } from "@alloy/i18n"
import { useDocumentEvent } from "@alloy/ui/hooks/use-document-event"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import type { MouseEvent, MouseEventHandler } from "react"

import { errorMessage } from "@/lib/error-message"
import {
  exitFullscreenBestEffort,
  isFullscreenElement,
  requestFullscreenBestEffort,
} from "@/lib/fullscreen"

import { useMediaEngine } from "./video-media-engine"
import { useActiveVideoPlayer } from "./video-player-active"
import type { PlayerCoreProps } from "./video-player-core-types"
import { usePlayingTimeSync, usePlayThreshold } from "./video-player-hooks"
import {
  BareShell,
  ChromeBar,
  ChromeShell,
  LoadOverlay,
  type LoadStatus,
  type VideoKeyCommand,
} from "./video-player-shell"
import { VideoFrame } from "./video-player-video"
import { isInterruptedPlayRequest, mediaErrorMessage } from "./video-source"

export function PlayerCore({
  spec,
  hlsPlayback,
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
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
}: PlayerCoreProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { src: mediaUrl, mediaKey } = useMediaEngine(
    spec,
    videoRef,
    hlsPlayback,
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playingRef = useRef(false)
  const volumeRef = useRef(1)
  const mutedRef = useRef(initialMuted)
  const chromeHideTimerRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)
  const playRequestIdRef = useRef(0)
  const hasRenderedFrameRef = useRef(false)
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
  const [volume, setVolumeState] = useState(1)
  const [muted, setMutedState] = useState(initialMuted)
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const isCoarsePointer = useMediaQuery("(pointer: coarse)")

  const clearChromeHideTimer = useCallback(() => {
    if (chromeHideTimerRef.current === null) return
    window.clearTimeout(chromeHideTimerRef.current)
    chromeHideTimerRef.current = null
  }, [])

  const scheduleChromeHide = useCallback(
    (delayMs = isCoarsePointer ? 2600 : 1600) => {
      clearChromeHideTimer()
      chromeHideTimerRef.current = window.setTimeout(() => {
        setChromeVisible(false)
        chromeHideTimerRef.current = null
      }, delayMs)
    },
    [clearChromeHideTimer, isCoarsePointer],
  )

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

  const syncTime = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const nextTime = video.currentTime || 0
    const nextDuration = Number.isFinite(video.duration) ? video.duration : 0
    lastTimeRef.current = nextTime
    setCurrentTime(nextTime)
    setDuration(nextDuration)
    onTimeUpdateRef.current?.(nextTime)
  }, [])

  const syncBuffered = useCallback(() => {
    const video = videoRef.current
    if (!video || video.buffered.length === 0) {
      setBufferedEnd(0)
      return
    }
    setBufferedEnd(video.buffered.end(video.buffered.length - 1))
  }, [])

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

  useEffect(() => {
    mutedRef.current = initialMuted
    setMutedState(initialMuted)
    const video = videoRef.current
    if (video) video.muted = initialMuted
  }, [initialMuted])

  useEffect(() => {
    // A changed `identity` means a different clip. A changed media key with
    // the same identity is a source swap for the same clip (e.g. a pinned
    // quality switch on a player without MSE).
    const previous = prevSourceRef.current
    const isNewMedia = !previous || previous.identity !== identity
    // Load state only resets when the element will actually reload (a new
    // effective media URL). An identity change with an unchanged URL never
    // re-fires `loadedmetadata`, so entering "loading" there would strand the
    // spinner over a playing video. hls.js level switches keep the media key
    // stable, so they never reset load state.
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
    } else {
      // Same clip, different source: resume where the viewer was. Capture
      // the position/playing state now, before the element load resets them,
      // and leave the scrubber untouched so the UI doesn't jump to zero.
      resumeRef.current = {
        time: lastTimeRef.current,
        play: playingRef.current,
      }
    }
  }, [
    autoPlay,
    clearBuffering,
    clearChromeHideTimer,
    identity,
    isCoarsePointer,
    setPlayingState,
    mediaKey,
  ])

  const reportError = useCallback(() => {
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
  }, [clearBuffering, setPlayingState])

  const playInternal = useCallback(async (reportBlocked = true) => {
    const video = videoRef.current
    if (!video) return
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
  }, [])

  const pauseInternal = useCallback(() => {
    playRequestIdRef.current += 1
    videoRef.current?.pause()
  }, [])

  const seekInternal = useCallback(
    (targetSec: number, keepPlaying: boolean = playingRef.current) => {
      const video = videoRef.current
      if (!video) return
      const dur = Number.isFinite(video.duration) ? video.duration : targetSec
      const min = Math.max(0, shortcutBounds?.start ?? 0)
      const max = Math.max(
        min,
        Math.min(dur > 0 ? dur : targetSec, shortcutBounds?.end ?? dur),
      )
      const clamped = Math.max(
        min,
        Math.min(max, Number.isFinite(targetSec) ? targetSec : 0),
      )
      video.currentTime = clamped
      setCurrentTime(clamped)
      onTimeUpdateRef.current?.(clamped)
      if (keepPlaying) void playInternal()
    },
    [playInternal, shortcutBounds?.end, shortcutBounds?.start],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    volumeRef.current = volume
    mutedRef.current = muted
    video.volume = volume
    video.muted = muted
  }, [volume, muted])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = playbackRate
  }, [playbackRate])

  usePlayingTimeSync(playing, syncTime)

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
    } else {
      pauseInternal()
    }
  }, [pauseInternal, playInternal])

  const toggleMute = useCallback(() => {
    setMutedState((current) => {
      const next = !current
      mutedRef.current = next
      const video = videoRef.current
      if (video) video.muted = next
      return next
    })
  }, [])

  const setVolume = useCallback((next: number) => {
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
  }, [])

  const volumeBy = useCallback(
    (delta: number) => {
      setVolume(volumeRef.current + delta)
    },
    [setVolume],
  )

  const seekBy = useCallback(
    (deltaSec: number) => {
      const video = videoRef.current
      if (!video) return
      seekInternal((video.currentTime || 0) + deltaSec)
    },
    [seekInternal],
  )

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (isFullscreenElement(el)) {
      exitFullscreenBestEffort("video player")
    } else {
      requestFullscreenBestEffort(el, "video player")
    }
  }, [])

  const onFullscreenChange = useCallback(() => {
    const nextIsFullscreen = isFullscreenElement(containerRef.current)
    if (nextIsFullscreen && isCoarsePointer) screen.orientation?.unlock?.()
    setChromeVisible(true)
  }, [isCoarsePointer])

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
    const nextDuration = Number.isFinite(element.duration)
      ? element.duration
      : 0
    setDuration(nextDuration)
    setBufferedEnd(0)
    element.volume = volumeRef.current
    element.muted = mutedRef.current
    element.playbackRate = playbackRate
    setStatus({ kind: "ready" })
    clearBuffering()

    const resume = resumeRef.current
    resumeRef.current = null
    if (resume && resume.time > 0) {
      // Restore the position from before a quality switch, then continue
      // playing if the viewer was. The poster stays up until the seeked frame
      // decodes, so there is no black flash.
      const target =
        nextDuration > 0 ? Math.min(resume.time, nextDuration) : resume.time
      try {
        element.currentTime = target
      } catch {
        // Seeking can throw if the element is not yet seekable; the timeupdate
        // loop will reconcile the scrubber regardless.
      }
      lastTimeRef.current = target
      setCurrentTime(target)
      if (resume.play) void playInternal(false)
    } else {
      setCurrentTime(element.currentTime || 0)
      if (autoPlay) void playInternal(false)
    }
    syncBuffered()
  }, [autoPlay, clearBuffering, playbackRate, playInternal, syncBuffered])

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

  const posterVisible = Boolean(poster) && !hasRenderedFrame

  const handleTimeUpdate = useCallback(() => {
    syncTime()
    syncBuffered()
  }, [syncBuffered, syncTime])

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
      placeholderVisible={!hasRenderedFrame}
      posterVisible={posterVisible}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      onPointerDown={focusPlayerContainer}
      onClick={clickHandler}
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={handleLoadedData}
      onCanPlay={handleCanPlay}
      onWaiting={handleWaiting}
      onStalled={handleWaiting}
      onPlaying={clearBuffering}
      onDurationChange={syncTime}
      onTimeUpdate={handleTimeUpdate}
      onProgress={syncBuffered}
      onPlay={() => setPlayingState(true)}
      onPause={() => {
        setPlayingState(false)
        clearBuffering()
      }}
      onEnded={() => {
        setPlayingState(false)
        syncTime()
        onEndedRef.current?.()
      }}
      onError={reportError}
    />
  )

  if (!controls) {
    return (
      <BareShell
        containerRef={containerRef}
        className={className}
        status={status}
        buffering={buffering}
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
          onSeek={(seconds) => seekInternal(seconds)}
          onToggleFullscreen={toggleFullscreen}
          qualityOptions={qualityOptions}
          selectedQualityId={selectedQualityId}
          onSelectQuality={onSelectQuality}
        />
      }
    >
      {renderVideo(handleControlledVideoClick)}

      <LoadOverlay status={status} buffering={buffering} />
    </ChromeShell>
  )
}
