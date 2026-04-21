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
  children,
}: {
  className?: string
  status: LoadStatus
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="video-player"
      data-mode="bare"
      className={cn(
        "relative aspect-video w-full overflow-hidden bg-black",
        className
      )}
    >
      {children}
      <LoadOverlay status={status} />
    </div>
  )
}

export function ChromeShell({
  containerRef,
  className,
  playing,
  onKeyCommand,
  children,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  className?: string
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
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseMove={revealChrome}
      onMouseLeave={() => {
        if (playing) setChromeVisible(false)
      }}
      style={{
        cursor: chromeVisible ? undefined : "none",
      }}
      className={cn(
        "group/video relative aspect-video w-full overflow-hidden bg-black select-none",
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
        "pointer-events-auto absolute inset-x-0 bottom-0 isolate z-20 flex flex-col gap-1",
        "bg-gradient-to-t from-[oklch(0_0_0/0.55)] via-[oklch(0_0_0/0.3)] to-transparent px-4 pt-8 pb-2",
        "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "group-data-[chrome=hidden]/video:pointer-events-none group-data-[chrome=hidden]/video:opacity-0"
      )}
    >
      <div>
        <Scrubber
          currentTime={currentTime}
          duration={duration}
          bufferedEnd={bufferedEnd}
          onSeek={onSeek}
        />
      </div>

      <div className="flex items-center gap-2 text-foreground">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={playing ? "Pause" : "Play"}
          onClick={onTogglePlay}
          className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>

        <VolumeControl
          muted={muted}
          volume={volume}
          onToggleMute={onToggleMute}
          onVolumeChange={onVolumeChange}
        />

        <span className="ml-1 inline-flex h-8 items-center text-sm text-foreground tabular-nums">
          <span className="text-accent">{formatTime(currentTime)}</span>
          <span className="mx-1 text-foreground-faint">/</span>
          <span className="text-foreground-muted">{formatTime(duration)}</span>
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          <SettingsMenu
            qualityOptions={qualityOptions}
            selectedQualityId={selectedQualityId}
            onSelectQuality={onSelectQuality}
            downloadOptions={downloadOptions}
          />
          {fullscreenSupported ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={onToggleFullscreen}
              className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
            >
              <MaximizeIcon />
            </Button>
          ) : null}
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
        "text-center text-xs text-foreground-muted",
        status.kind === "loading"
          ? "bg-[color-mix(in_oklab,var(--neutral-0)_20%,transparent)]"
          : ""
      )}
    >
      {status.kind === "loading" ? (
        <span className="rounded-sm bg-background/70 px-2 py-1 backdrop-blur-sm">
          Loading...
        </span>
      ) : (
        <span className="max-w-[80%] rounded-sm bg-background/80 px-3 py-2 text-foreground backdrop-blur-sm">
          {status.message}
        </span>
      )}
    </div>
  )
}
