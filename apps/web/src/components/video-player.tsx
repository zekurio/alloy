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
  /** Thumbnail shown in a controlled overlay until a decoded frame is ready. */
  poster?: string
  /** Stable box ratio. When omitted, the player falls back to 16:9. */
  aspectRatio?: number
  sourceIdentity?: string
  /** Default true. Set false to hide the Alloy chrome. */
  controls?: boolean
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  playbackRate?: number
}

type SourceSpec = { kind: "url"; url: string } | { kind: "file"; file: File }

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
  aspectRatio,
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
      aspectRatio={aspectRatio}
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
  aspectRatio?: number
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
  aspectRatio,
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
  const [hasRenderedFrame, setHasRenderedFrame] = React.useState(false)

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

  React.useEffect(() => {
    setStatus({ kind: "loading" })
    setDuration(0)
    setCurrentTime(0)
    setBufferedEnd(0)
    setHasRenderedFrame(false)
    setPlayingState(false)
  }, [identity, mediaUrl, setPlayingState])

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
    if (autoPlay) void playInternal()
  }, [autoPlay, playbackRate, playInternal, syncBuffered])

  const handleLoadedData = React.useCallback(() => {
    setHasRenderedFrame(true)
  }, [])

  const posterVisible = Boolean(poster) && !hasRenderedFrame

  const handleTimeUpdate = React.useCallback(() => {
    syncTime()
    syncBuffered()
  }, [syncBuffered, syncTime])

  const renderVideo = (
    clickHandler?: React.MouseEventHandler<HTMLVideoElement>
  ) => (
    <>
      <div aria-hidden className="absolute inset-0 bg-black" />
      {posterVisible ? (
        <img
          src={poster}
          alt=""
          aria-hidden
          className={cn(
            "absolute inset-0 size-full object-contain object-center",
            "transition-opacity duration-200 ease-out"
          )}
          decoding="async"
          fetchPriority="high"
        />
      ) : null}
      <video
        ref={videoRef}
        src={mediaUrl ?? undefined}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline
        preload="metadata"
        controls={false}
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
        }}
        onError={reportError}
        className="absolute inset-0 block h-full w-full object-contain object-center"
      />
    </>
  )

  if (!controls) {
    return (
      <BareShell
        className={className}
        status={status}
        aspectRatio={aspectRatio}
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
      {renderVideo((e: React.MouseEvent<HTMLVideoElement>) => {
        onVideoClick?.(e)
        togglePlay()
      })}

      {status.kind !== "ready" ? null : !playing ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 grid place-items-center",
            "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]"
          )}
        >
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              posterVisible
                ? "bg-gradient-to-t from-black/40 via-black/10 to-transparent"
                : "bg-black/12"
            )}
          />
          <button
            type="button"
            aria-label="Play"
            onClick={togglePlay}
            className={cn(
              "pointer-events-auto relative z-10 grid size-16 place-items-center rounded-full border",
              "alloy-glass text-white",
              "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:scale-[1.03]"
            )}
            style={
              {
                "--alloy-glass-hue": "var(--surface)",
                "--alloy-glass-opacity": "60%",
                "--alloy-glass-shadow": "0 18px 50px -24px rgb(0 0 0 / 0.9)",
              } as React.CSSProperties
            }
          >
            <PlayIcon className="size-5 translate-x-[1px]" />
          </button>
        </div>
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
