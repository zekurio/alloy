import * as React from "react"
import { PlayIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { usePlayThreshold } from "./video-player-hooks"
import {
  BareShell,
  ChromeBar,
  ChromeShell,
  LoadOverlay,
  type LoadStatus,
} from "./video-player-shells"

export { VolumeControl } from "./video-volume-control"

export interface VideoPlayerHandle {
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  getCurrentTime(): number
  getDuration(): number
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  setPlaybackRate(rate: number): void
}

type SharedPlayerProps = {
  className?: string
  playerRef?: React.Ref<VideoPlayerHandle>
  onTimeUpdate?: (seconds: number) => void
  onPlayingChange?: (playing: boolean) => void
  onVideoClick?: React.MouseEventHandler<HTMLVideoElement>
  onPlaybackError?: (message: string) => void
  onPlayThreshold?: () => void
  qualityOptions?: Array<{ id: string; label: string }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  downloadOptions?: Array<{ id: string; label: string; url: string }>
}

interface VideoPlayerProps extends SharedPlayerProps {
  src: string | File
  /** Thumbnail rendered by the native video element until the first frame. */
  poster?: string
  sourceIdentity?: string
  /** Default true. Set false to hide the Alloy chrome. */
  controls?: boolean
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  playbackRate?: number
}

type SourceSpec =
  | { kind: "url"; url: string }
  | { kind: "file"; file: File }

function toSourceSpec(src: string | File): SourceSpec {
  return typeof src === "string"
    ? { kind: "url", url: src }
    : { kind: "file", file: src }
}

function sourceSpecKey(spec: SourceSpec): string {
  return spec.kind === "url"
    ? `url:${spec.url}`
    : `file:${spec.file.name}:${spec.file.size}:${spec.file.lastModified}`
}

function useMediaUrl(spec: SourceSpec): string | null {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (spec.kind === "url") {
      setObjectUrl(null)
      return
    }

    const url = URL.createObjectURL(spec.file)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [spec])

  return spec.kind === "url" ? spec.url : objectUrl
}

export function VideoPlayer({
  src,
  sourceIdentity,
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  playbackRate = 1,
  ...rest
}: VideoPlayerProps) {
  const spec = React.useMemo(() => toSourceSpec(src), [src])
  const specKey = sourceSpecKey(spec)
  const identity = sourceIdentity ?? specKey

  return (
    <PlayerCore
      key={specKey}
      spec={spec}
      identity={identity}
      controls={controls}
      autoPlay={autoPlay}
      loop={loop}
      initialMuted={muted}
      playbackRate={playbackRate}
      {...rest}
    />
  )
}

type PlayerCoreProps = SharedPlayerProps & {
  spec: SourceSpec
  identity: string
  poster?: string
  controls: boolean
  autoPlay: boolean
  loop: boolean
  initialMuted: boolean
  playbackRate: number
}

function PlayerCore({
  spec,
  identity,
  poster,
  controls,
  autoPlay,
  loop,
  initialMuted,
  className,
  playerRef,
  onTimeUpdate,
  onPlayingChange,
  onVideoClick,
  onPlaybackError,
  onPlayThreshold,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
  downloadOptions,
  playbackRate,
}: PlayerCoreProps) {
  const mediaUrl = useMediaUrl(spec)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const playingRef = React.useRef(false)
  const volumeRef = React.useRef(1)
  const mutedRef = React.useRef(initialMuted)

  const [status, setStatus] = React.useState<LoadStatus>({ kind: "loading" })
  const [duration, setDuration] = React.useState(0)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [bufferedEnd, setBufferedEnd] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [volume, setVolumeState] = React.useState(1)
  const [muted, setMutedState] = React.useState(initialMuted)

  const onTimeUpdateRef = React.useRef(onTimeUpdate)
  const onPlayingChangeRef = React.useRef(onPlayingChange)
  const onPlaybackErrorRef = React.useRef(onPlaybackError)
  React.useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate
    onPlayingChangeRef.current = onPlayingChange
    onPlaybackErrorRef.current = onPlaybackError
  }, [onTimeUpdate, onPlayingChange, onPlaybackError])

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

  const reportError = React.useCallback(() => {
    const video = videoRef.current
    const message = mediaErrorMessage(video)
    setStatus({ kind: "error", message })
    setPlayingState(false)
    onPlaybackErrorRef.current?.(message)
  }, [setPlayingState])

  const playInternal = React.useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    try {
      await video.play()
    } catch (err) {
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
      const clamped = Math.max(
        0,
        Math.min(
          dur > 0 ? dur : targetSec,
          Number.isFinite(targetSec) ? targetSec : 0
        )
      )
      video.currentTime = clamped
      setCurrentTime(clamped)
      onTimeUpdateRef.current?.(clamped)
      if (keepPlaying) void playInternal()
    },
    [playInternal]
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

  const seekBy = React.useCallback(
    (deltaSec: number) => {
      const video = videoRef.current
      if (!video) return
      seekInternal((video.currentTime || 0) + deltaSec)
    },
    [seekInternal]
  )

  usePlayThreshold({
    playing,
    duration,
    identity,
    onPlayThreshold,
  })

  const video = (
    <video
      ref={videoRef}
      src={mediaUrl ?? undefined}
      poster={poster}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      playsInline
      preload="metadata"
      controls={false}
      onClick={controls ? undefined : onVideoClick}
      onLoadedMetadata={() => {
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
        if (autoPlay) void playInternal()
      }}
      onDurationChange={syncTime}
      onTimeUpdate={() => {
        syncTime()
        syncBuffered()
      }}
      onProgress={syncBuffered}
      onPlay={() => setPlayingState(true)}
      onPause={() => setPlayingState(false)}
      onEnded={() => {
        setPlayingState(false)
        syncTime()
      }}
      onError={reportError}
      // Bleeds 1px past every edge; the shell's overflow-hidden clips it.
      // Stops Chromium's sub-pixel seam when an ancestor has a transform.
      className="absolute -inset-px block bg-black object-contain"
    />
  )

  if (!controls) {
    return (
      <BareShell className={className} status={status}>
        {video}
      </BareShell>
    )
  }

  return (
    <ChromeShell
      containerRef={containerRef}
      className={className}
      playing={playing}
      onKeyCommand={{
        togglePlay,
        toggleMute,
        seekBy,
        toggleFullscreen: () => {
          const el = containerRef.current
          if (!el) return
          if (document.fullscreenElement === el) {
            void document.exitFullscreen().catch(() => undefined)
          } else {
            void el.requestFullscreen().catch(() => undefined)
          }
        },
      }}
    >
      {React.cloneElement(video, {
        onClick: (e: React.MouseEvent<HTMLVideoElement>) => {
          onVideoClick?.(e)
          togglePlay()
        },
      })}

      {status.kind !== "ready" ? null : !playing ? (
        <button
          type="button"
          aria-label="Play"
          onClick={togglePlay}
          className={cn(
            "absolute inset-0 grid place-items-center",
            "bg-[color-mix(in_oklab,var(--neutral-0)_40%,transparent)]",
            "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]"
          )}
        >
          <span
            className={cn(
              "grid size-14 place-items-center rounded-full",
              "bg-accent text-accent-foreground",
              "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "group-hover/video:scale-105"
            )}
          >
            <PlayIcon className="size-5 translate-x-[1px]" />
          </span>
        </button>
      ) : null}

      <LoadOverlay status={status} />

      <ChromeBar
        playing={playing}
        duration={duration}
        currentTime={currentTime}
        bufferedEnd={bufferedEnd}
        muted={muted}
        volume={volume}
        onTogglePlay={togglePlay}
        onToggleMute={toggleMute}
        onVolumeChange={setVolume}
        onSeek={(seconds) => seekInternal(seconds)}
        qualityOptions={qualityOptions}
        selectedQualityId={selectedQualityId}
        onSelectQuality={onSelectQuality}
        downloadOptions={downloadOptions}
        onToggleFullscreen={() => {
          const el = containerRef.current
          if (!el) return
          if (document.fullscreenElement === el) {
            void document.exitFullscreen().catch(() => undefined)
          } else {
            void el.requestFullscreen().catch(() => undefined)
          }
        }}
      />
    </ChromeShell>
  )
}

function mediaErrorMessage(video: HTMLVideoElement | null): string {
  const error = video?.error
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Video loading was aborted."
    case MediaError.MEDIA_ERR_NETWORK:
      return "Network error while loading the video."
    case MediaError.MEDIA_ERR_DECODE:
      return "The browser could not decode this video."
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This video source is not supported by the browser."
    default:
      return "Video playback failed."
  }
}
