import * as React from "react"
import { MaximizeIcon, PauseIcon, PlayIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { formatTime } from "./video-player-hooks"
import { Scrubber } from "./video-scrubber"
import { SettingsMenu } from "./video-settings-menu"
import { VolumeControl } from "./video-volume-control"

export type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }

export function BareShell({
  className,
  status,
  aspectRatio,
  children,
}: {
  className?: string
  status: LoadStatus
  aspectRatio?: number
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="video-player"
      data-mode="bare"
      className={cn(
        "relative isolate w-full overflow-hidden bg-black",
        !aspectRatio && "aspect-video",
        className
      )}
      style={aspectRatio ? { aspectRatio: String(aspectRatio) } : undefined}
    >
      {children}
      <LoadOverlay status={status} />
    </div>
  )
}

export function ChromeShell({
  containerRef,
  className,
  aspectRatio,
  playing,
  onKeyCommand,
  children,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  className?: string
  aspectRatio?: number
  playing: boolean
  onKeyCommand: {
    togglePlay: () => void
    toggleMute: () => void
    seekBy: (delta: number) => void
    toggleFullscreen: () => void
  }
  children: React.ReactNode
}) {
  const [chromeVisible, setChromeVisible] = React.useState(true)
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleHide = React.useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setChromeVisible(false), 2000)
  }, [])

  const revealChrome = React.useCallback(() => {
    setChromeVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (playing) scheduleHide()
  }, [playing, scheduleHide])

  React.useEffect(() => {
    if (!playing) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      setChromeVisible(true)
      return
    }
    scheduleHide()
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [playing, scheduleHide])

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return
      if (e.key === " " || e.code === "Space") {
        e.preventDefault()
        onKeyCommand.togglePlay()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        onKeyCommand.seekBy(-5)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        onKeyCommand.seekBy(5)
      } else if (e.key.toLowerCase() === "m") {
        e.preventDefault()
        onKeyCommand.toggleMute()
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault()
        onKeyCommand.toggleFullscreen()
      }
    },
    [onKeyCommand]
  )

  return (
    <div
      ref={containerRef}
      data-slot="video-player"
      data-mode="chrome"
      data-playing={playing ? "true" : "false"}
      data-chrome={chromeVisible ? "visible" : "hidden"}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={revealChrome}
      onMouseLeave={() => {
        if (playing) setChromeVisible(false)
      }}
      style={{
        ...(aspectRatio ? { aspectRatio: String(aspectRatio) } : {}),
        cursor: chromeVisible ? undefined : "none",
      }}
      className={cn(
        "group/video relative isolate w-full overflow-hidden bg-black select-none",
        !aspectRatio && "aspect-video",
        "focus:outline-none",
        className
      )}
    >
      {children}
    </div>
  )
}

export function ChromeBar({
  playing,
  duration,
  currentTime,
  bufferedEnd,
  muted,
  volume,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onSeek,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
  downloadOptions,
  onToggleFullscreen,
}: {
  playing: boolean
  duration: number
  currentTime: number
  bufferedEnd: number
  muted: boolean
  volume: number
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (v: number) => void
  onSeek: (sec: number) => void
  qualityOptions?: Array<{ id: string; label: string }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  downloadOptions?: Array<{ id: string; label: string; url: string }>
  onToggleFullscreen: () => void
}) {
  const [fullscreenSupported, setFullscreenSupported] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const glassStyle = {
    "--alloy-glass-hue": "var(--surface)",
    "--alloy-glass-opacity": "34%",
    "--alloy-glass-shadow": "0 16px 36px -28px rgb(0 0 0 / 0.72)",
  } as React.CSSProperties

  React.useEffect(() => {
    if (typeof document === "undefined") return
    setFullscreenSupported(Boolean(document.fullscreenEnabled))
  }, [])

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  return (
    <div
      aria-hidden={false}
      className={cn(
        "pointer-events-auto absolute inset-x-0 bottom-0 isolate z-20",
        "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "group-data-[chrome=hidden]/video:pointer-events-none group-data-[chrome=hidden]/video:opacity-0"
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/90 via-black/45 to-transparent"
      />

      <div className="relative flex flex-col gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="px-1 text-white">
          <Scrubber
            currentTime={currentTime}
            duration={duration}
            bufferedEnd={bufferedEnd}
            onSeek={onSeek}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-white">
          <div
            className="alloy-glass inline-flex items-center gap-1 rounded-full border px-1.5 py-1"
            style={glassStyle}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={playing ? "Pause" : "Play"}
              onClick={onTogglePlay}
              className="rounded-full text-white/82 hover:bg-white/10 hover:text-white"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </Button>

            <VolumeControl
              muted={muted}
              volume={volume}
              onToggleMute={onToggleMute}
              onVolumeChange={onVolumeChange}
            />
          </div>

          <div
            className="alloy-glass inline-flex h-10 items-center rounded-full border px-4 text-sm text-white/88 tabular-nums"
            style={glassStyle}
          >
            <span>{formatTime(currentTime)}</span>
            <span className="mx-1 text-white/35">/</span>
            <span className="text-white/55">{formatTime(duration)}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <SettingsMenu
              qualityOptions={qualityOptions}
              selectedQualityId={selectedQualityId}
              onSelectQuality={onSelectQuality}
              downloadOptions={downloadOptions}
              triggerClassName="alloy-glass rounded-full border p-1"
              triggerStyle={glassStyle}
            />
            {fullscreenSupported ? (
              <div
                className="alloy-glass rounded-full border p-1"
                style={glassStyle}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  onClick={onToggleFullscreen}
                  className="rounded-full text-white/82 hover:bg-white/10 hover:text-white"
                >
                  <MaximizeIcon />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function LoadOverlay({ status }: { status: LoadStatus }) {
  if (status.kind === "ready") return null
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 grid place-items-center",
        "text-center text-xs text-white/72",
        status.kind === "loading" ? "bg-transparent" : ""
      )}
    >
      {status.kind === "loading" ? (
        <span
          className="alloy-glass rounded-full border px-3 py-1"
          style={
            {
              "--alloy-glass-hue": "var(--surface)",
              "--alloy-glass-opacity": "62%",
            } as React.CSSProperties
          }
        >
          Loading...
        </span>
      ) : (
        <span
          className="alloy-glass max-w-[80%] rounded-xl border px-3 py-2 text-white"
          style={
            {
              "--alloy-glass-hue": "var(--surface)",
              "--alloy-glass-opacity": "74%",
            } as React.CSSProperties
          }
        >
          {status.message}
        </span>
      )}
    </div>
  )
}
