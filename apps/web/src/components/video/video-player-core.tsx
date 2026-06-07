import { useDocumentEvent } from "alloy-ui/hooks/use-document-event"
import { useMediaQuery } from "alloy-ui/hooks/use-media-query"
import * as React from "react"

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
import { mediaErrorMessage, sourceSpecKey } from "./video-source"

export function PlayerCore({
  spec,
  identity,
  poster,
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
  onEnded,
  chromeSize = "default",
  shortcutBounds,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
  enableHorizontalSeekShortcuts = true,
  playbackRate,
  hlsLevelHeight = "auto",
  onHlsFatalError,
}: PlayerCoreProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const { src: mediaUrl } = useMediaEngine(
    videoRef,
    spec,
    hlsLevelHeight,
    onHlsFatalError,
  )
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const playingRef = React.useRef(false)
  const volumeRef = React.useRef(1)
  const mutedRef = React.useRef(initialMuted)
  const chromeHideTimerRef = React.useRef<number | null>(null)
  const lastTimeRef = React.useRef(0)
  const resumeRef = React.useRef<{ time: number; play: boolean } | null>(null)
  const prevSourceRef = React.useRef<{
    identity: string
    specKey: string
  } | null>(null)
  const specKey = sourceSpecKey(spec)

  const [status, setStatus] = React.useState<LoadStatus>({ kind: "loading" })
  const [duration, setDuration] = React.useState(0)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [bufferedEnd, setBufferedEnd] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [volume, setVolumeState] = React.useState(1)
  const [muted, setMutedState] = React.useState(initialMuted)
  const [hasRenderedFrame, setHasRenderedFrame] = React.useState(false)
  const [chromeVisible, setChromeVisible] = React.useState(true)
  const isCoarsePointer = useMediaQuery("(pointer: coarse)")

  const clearChromeHideTimer = React.useCallback(() => {
    if (chromeHideTimerRef.current === null) return
    window.clearTimeout(chromeHideTimerRef.current)
    chromeHideTimerRef.current = null
  }, [])

  const scheduleChromeHide = React.useCallback(
    (delayMs = isCoarsePointer ? 2600 : 1600) => {
      clearChromeHideTimer()
      chromeHideTimerRef.current = window.setTimeout(() => {
        setChromeVisible(false)
        chromeHideTimerRef.current = null
      }, delayMs)
    },
    [clearChromeHideTimer, isCoarsePointer],
  )

  const onTimeUpdateRef = React.useRef(onTimeUpdate)
  const onPlayingChangeRef = React.useRef(onPlayingChange)
  const onPlaybackErrorRef = React.useRef(onPlaybackError)
  const onEndedRef = React.useRef(onEnded)
  React.useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate
    onPlayingChangeRef.current = onPlayingChange
    onPlaybackErrorRef.current = onPlaybackError
    onEndedRef.current = onEnded
  }, [onTimeUpdate, onPlayingChange, onPlaybackError, onEnded])

  const syncTime = React.useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const nextTime = video.currentTime || 0
    const nextDuration = Number.isFinite(video.duration) ? video.duration : 0
    lastTimeRef.current = nextTime
    setCurrentTime(nextTime)
    setDuration(nextDuration)
    onTimeUpdateRef.current?.(nextTime)
  }, [])

  const syncBuffered = React.useCallback(() => {
    const video = videoRef.current
    if (!video || video.buffered.length === 0) {
      setBufferedEnd(0)
      return
    }
    setBufferedEnd(video.buffered.end(video.buffered.length - 1))
  }, [])

  const setPlayingState = React.useCallback((next: boolean) => {
    if (playingRef.current === next) return
    playingRef.current = next
    setPlaying(next)
    onPlayingChangeRef.current?.(next)
  }, [])

  React.useEffect(() => {
    mutedRef.current = initialMuted
    setMutedState(initialMuted)
    const video = videoRef.current
    if (video) video.muted = initialMuted
  }, [initialMuted])

  React.useEffect(() => {
    // A changed `identity` means a different clip. A changed SourceSpec with
    // the same identity is a rendition/source swap for the same clip; this also
    // covers hls.js playback, where `mediaUrl` stays null while the engine
    // reloads a manifest.
    const previous = prevSourceRef.current
    const isNewMedia = !previous || previous.identity !== identity
    const isSourceChange =
      isNewMedia || !previous || previous.specKey !== specKey
    prevSourceRef.current = { identity, specKey }

    if (!isSourceChange) return

    setStatus({ kind: "loading" })
    setBufferedEnd(0)
    setHasRenderedFrame(false)
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
      // Same clip, different rendition: resume where the viewer was. Capture
      // the position/playing state now, before the element load resets them,
      // and leave the scrubber untouched so the UI doesn't jump to zero.
      resumeRef.current = {
        time: lastTimeRef.current,
        play: playingRef.current,
      }
    }
  }, [
    autoPlay,
    clearChromeHideTimer,
    identity,
    isCoarsePointer,
    setPlayingState,
    specKey,
  ])

  const reportError = React.useCallback(() => {
    const video = videoRef.current
    const message = mediaErrorMessage(video)
    setPlayingState(false)
    if (onPlaybackErrorRef.current) {
      setStatus({ kind: "ready" })
      onPlaybackErrorRef.current(message)
    } else {
      setStatus({ kind: "error", message })
    }
  }, [setPlayingState])

  const playInternal = React.useCallback(async (reportBlocked = true) => {
    const video = videoRef.current
    if (!video) return
    try {
      await video.play()
    } catch (err) {
      if (!reportBlocked) return
      const message = errorMessage(err, "Playback failed")
      if (onPlaybackErrorRef.current) {
        setStatus({ kind: "ready" })
        onPlaybackErrorRef.current(message)
      } else {
        setStatus({ kind: "error", message })
      }
    }
  }, [])

  const pauseInternal = React.useCallback(() => {
    videoRef.current?.pause()
  }, [])

  const seekInternal = React.useCallback(
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

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return
    volumeRef.current = volume
    mutedRef.current = muted
    video.volume = volume
    video.muted = muted
  }, [volume, muted])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = playbackRate
  }, [playbackRate])

  usePlayingTimeSync(playing, syncTime)

  React.useImperativeHandle(
    playerRef,
    () => ({
      play: () => playInternal(),
      pause: () => pauseInternal(),
      seek: (seconds: number) => seekInternal(seconds),
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

  const togglePlay = React.useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused || video.ended) {
      void playInternal()
    } else {
      pauseInternal()
    }
  }, [pauseInternal, playInternal])

  const toggleMute = React.useCallback(() => {
    setMutedState((current) => {
      const next = !current
      mutedRef.current = next
      const video = videoRef.current
      if (video) video.muted = next
      return next
    })
  }, [])

  const setVolume = React.useCallback((next: number) => {
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

  const volumeBy = React.useCallback(
    (delta: number) => {
      setVolume(volumeRef.current + delta)
    },
    [setVolume],
  )

  const seekBy = React.useCallback(
    (deltaSec: number) => {
      const video = videoRef.current
      if (!video) return
      seekInternal((video.currentTime || 0) + deltaSec)
    },
    [seekInternal],
  )

  const toggleFullscreen = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (isFullscreenElement(el)) {
      exitFullscreenBestEffort("video player")
    } else {
      requestFullscreenBestEffort(el, "video player")
    }
  }, [])

  const onFullscreenChange = React.useCallback(() => {
    const nextIsFullscreen = isFullscreenElement(containerRef.current)
    if (nextIsFullscreen && isCoarsePointer) screen.orientation?.unlock?.()
    setChromeVisible(true)
  }, [isCoarsePointer])

  React.useEffect(() => {
    onFullscreenChange()
  }, [onFullscreenChange])
  useDocumentEvent("fullscreenchange", onFullscreenChange)

  const keyCommand = React.useMemo<VideoKeyCommand>(
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

  React.useEffect(() => {
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

  const handleLoadedMetadata = React.useCallback(() => {
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
  }, [autoPlay, playbackRate, playInternal, syncBuffered])

  const handleLoadedData = React.useCallback(() => {
    setHasRenderedFrame(true)
  }, [])

  const posterVisible = Boolean(poster) && !hasRenderedFrame

  const handleTimeUpdate = React.useCallback(() => {
    syncTime()
    syncBuffered()
  }, [syncBuffered, syncTime])

  const handleChromePointerMove = React.useCallback(() => {
    if (isCoarsePointer) return
    setChromeVisible(true)
    if (playingRef.current) scheduleChromeHide()
  }, [isCoarsePointer, scheduleChromeHide])

  const handleChromePointerLeave = React.useCallback(() => {
    if (isCoarsePointer) return
    clearChromeHideTimer()
    setChromeVisible(false)
  }, [clearChromeHideTimer, isCoarsePointer])

  const handleControlledVideoClick = React.useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
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

  const renderVideo = (
    clickHandler?: React.MouseEventHandler<HTMLVideoElement>,
  ) => (
    <VideoFrame
      videoRef={videoRef}
      mediaUrl={mediaUrl}
      poster={poster}
      posterVisible={posterVisible}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      onPointerDown={focusPlayerContainer}
      onClick={clickHandler}
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={handleLoadedData}
      onDurationChange={syncTime}
      onTimeUpdate={handleTimeUpdate}
      onProgress={syncBuffered}
      onPlay={() => setPlayingState(true)}
      onPause={() => setPlayingState(false)}
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
          qualityOptions={qualityOptions}
          selectedQualityId={selectedQualityId}
          onSelectQuality={onSelectQuality}
          onToggleFullscreen={toggleFullscreen}
        />
      }
    >
      {renderVideo(handleControlledVideoClick)}

      <LoadOverlay status={status} />
    </ChromeShell>
  )
}
