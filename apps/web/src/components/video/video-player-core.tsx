import * as React from "react"
import { useMediaQuery } from "@workspace/ui/hooks/use-media-query"

import { usePlayThreshold } from "./video-player-hooks"
import { VideoFrame } from "./video-player-video"
import {
  BareShell,
  ChromeBar,
  ChromeShell,
  handleVideoKeyCommand,
  LoadOverlay,
  shouldHandleGlobalVideoShortcut,
  type LoadStatus,
  type VideoKeyCommand,
} from "./video-player-shell"
import { mediaErrorMessage, useMediaUrl, type SourceSpec } from "./video-source"
import type { SharedPlayerProps } from "./video-player-types"

let activeVideoPlayerId: string | null = null

type PlayerCoreProps = SharedPlayerProps & {
  spec: SourceSpec
  identity: string
  poster?: string
  aspectRatio?: number
  controls: boolean
  autoPlay: boolean
  loop: boolean
  initialMuted: boolean
  playbackRate: number
}

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
}: PlayerCoreProps) {
  const mediaUrl = useMediaUrl(spec)
  const playerId = React.useId()
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const playingRef = React.useRef(false)
  const volumeRef = React.useRef(1)
  const mutedRef = React.useRef(initialMuted)
  const chromeHideTimerRef = React.useRef<number | null>(null)

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
    [clearChromeHideTimer, isCoarsePointer]
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
    setStatus({ kind: "loading" })
    setDuration(0)
    setCurrentTime(0)
    setBufferedEnd(0)
    setHasRenderedFrame(false)
    setPlayingState(false)
    clearChromeHideTimer()
    setChromeVisible(!(isCoarsePointer && autoPlay))
  }, [
    autoPlay,
    clearChromeHideTimer,
    identity,
    isCoarsePointer,
    mediaUrl,
    setPlayingState,
  ])

  const reportError = React.useCallback(() => {
    const video = videoRef.current
    const message = mediaErrorMessage(video)
    setStatus({ kind: "error", message })
    setPlayingState(false)
    onPlaybackErrorRef.current?.(message)
  }, [setPlayingState])

  const playInternal = React.useCallback(async (reportBlocked = true) => {
    const video = videoRef.current
    if (!video) return
    try {
      await video.play()
    } catch (err) {
      if (!reportBlocked) return
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ kind: "error", message })
      onPlaybackErrorRef.current?.(message)
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
        Math.min(dur > 0 ? dur : targetSec, shortcutBounds?.end ?? dur)
      )
      const clamped = Math.max(
        min,
        Math.min(max, Number.isFinite(targetSec) ? targetSec : 0)
      )
      video.currentTime = clamped
      setCurrentTime(clamped)
      onTimeUpdateRef.current?.(clamped)
      if (keepPlaying) void playInternal()
    },
    [playInternal, shortcutBounds?.end, shortcutBounds?.start]
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

  React.useEffect(() => {
    if (!playing) return
    let rafId = 0
    const tick = () => {
      syncTime()
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [playing, syncTime])

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
    [pauseInternal, playInternal, seekInternal]
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
    [setVolume]
  )

  const seekBy = React.useCallback(
    (deltaSec: number) => {
      const video = videoRef.current
      if (!video) return
      seekInternal((video.currentTime || 0) + deltaSec)
    },
    [seekInternal]
  )

  const toggleFullscreen = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      void el.requestFullscreen().catch(() => undefined)
    }
  }, [])

  React.useEffect(() => {
    if (typeof document === "undefined") return

    const onFullscreenChange = () => {
      const nextIsFullscreen =
        document.fullscreenElement === containerRef.current
      if (nextIsFullscreen && isCoarsePointer) screen.orientation?.unlock?.()
      setChromeVisible(true)
    }

    onFullscreenChange()
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [isCoarsePointer])

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
    ]
  )

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeVideoPlayerId !== playerId) return
      if (
        !shouldHandleGlobalVideoShortcut(event.target, containerRef.current)
      ) {
        return
      }
      if (
        handleVideoKeyCommand(event, keyCommand, {
          enableHorizontalSeek: enableHorizontalSeekShortcuts,
        })
      ) {
        containerRef.current?.focus({ preventScroll: true })
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [enableHorizontalSeekShortcuts, keyCommand, playerId])

  React.useEffect(() => {
    if (!autoPlay && controls) return
    activeVideoPlayerId = playerId
    return () => {
      if (activeVideoPlayerId === playerId) activeVideoPlayerId = null
    }
  }, [autoPlay, controls, playerId])

  const focusPlayerContainer = React.useCallback(() => {
    activeVideoPlayerId = playerId
    containerRef.current?.focus({ preventScroll: true })
  }, [playerId])

  const activatePlayer = React.useCallback(() => {
    activeVideoPlayerId = playerId
  }, [playerId])

  React.useEffect(() => {
    return () => {
      if (activeVideoPlayerId === playerId) activeVideoPlayerId = null
      clearChromeHideTimer()
    }
  }, [clearChromeHideTimer, playerId])

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
    setCurrentTime(element.currentTime || 0)
    setBufferedEnd(0)
    element.volume = volumeRef.current
    element.muted = mutedRef.current
    element.playbackRate = playbackRate
    setStatus({ kind: "ready" })
    syncBuffered()
    if (autoPlay) void playInternal(false)
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
    ]
  )

  const renderVideo = (
    clickHandler?: React.MouseEventHandler<HTMLVideoElement>
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
