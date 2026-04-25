import * as React from "react"
import { ListVideoIcon, MaximizeIcon, PauseIcon, PlayIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { formatTime, formatTimeStable } from "./video-player-hooks"
import { VideoScrubber } from "./video-scrubber"
import { VideoSettingsMenu } from "./video-settings-menu"
import { VolumeControl } from "./video-volume-control"

const KEYBOARD_SEEK_SECONDS = 5
const KEYBOARD_VOLUME_STEP = 0.1

/* ─── Reusable video-chrome primitives ─────────────────────────────── */

/** Translucent app-surface bar background for overlay chrome. */
export const videoChromeBarClass =
  "group/bar bg-surface-raised/95 text-foreground shadow-[var(--shadow-inset-top)] backdrop-blur-sm"

/** Icon button style for controls sitting on video chrome. */
export const videoChromeIconClass =
  "size-9 rounded-full text-foreground-muted hover:bg-neutral-150 hover:text-foreground focus-visible:ring-ring [&_svg]:size-5"

/* ─── Types ────────────────────────────────────────────────────────── */

export type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }

type VideoKeyCommand = {
  togglePlay: () => void
  toggleMute: () => void
  seekBy: (delta: number) => void
  seekTo: (seconds: number) => void
  volumeBy: (delta: number) => void
  toggleFullscreen: () => void
}

/* ─── Shells ───────────────────────────────────────────────────────── */

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
  bar,
  children,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  className?: string
  aspectRatio?: number
  playing: boolean
  onKeyCommand: VideoKeyCommand
  /** Chrome bar overlay — rendered as a sibling of the clipped video so its edges align pixel-perfect with the video container regardless of sub-pixel layout. */
  bar?: React.ReactNode
  children: React.ReactNode
}) {
  const [chromeVisible, setChromeVisible] = React.useState(true)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentAspectRatio = aspectRatio ?? 16 / 9

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

  React.useEffect(() => {
    if (typeof document === "undefined") return

    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }

    onFullscreenChange()
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [containerRef])

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!shouldHandleVideoShortcut(e.target, e.currentTarget)) return
      const key = e.key.toLowerCase()

      if (e.key === " " || e.code === "Space" || key === "k") {
        e.preventDefault()
        onKeyCommand.togglePlay()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        onKeyCommand.seekBy(-KEYBOARD_SEEK_SECONDS)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        onKeyCommand.seekBy(KEYBOARD_SEEK_SECONDS)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        onKeyCommand.volumeBy(KEYBOARD_VOLUME_STEP)
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        onKeyCommand.volumeBy(-KEYBOARD_VOLUME_STEP)
      } else if (e.key === "Home") {
        e.preventDefault()
        onKeyCommand.seekTo(0)
      } else if (e.key === "End") {
        e.preventDefault()
        onKeyCommand.seekTo(Number.POSITIVE_INFINITY)
      } else if (key === "m") {
        e.preventDefault()
        onKeyCommand.toggleMute()
      } else if (key === "f") {
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
      data-fullscreen={isFullscreen ? "true" : "false"}
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
        "group/video relative isolate w-full bg-black select-none",
        !aspectRatio && "aspect-video",
        "focus:outline-none",
        className
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          data-slot="video-player-frame"
          className={cn(
            "absolute inset-0",
            isFullscreen &&
              "top-1/2 right-auto bottom-auto left-1/2 h-auto max-h-dvh -translate-x-1/2 -translate-y-1/2"
          )}
          style={
            isFullscreen
              ? {
                  aspectRatio: String(contentAspectRatio),
                  width: `min(100dvw, calc(100dvh * ${contentAspectRatio}))`,
                }
              : undefined
          }
        >
          {children}
        </div>
      </div>
      {bar}
    </div>
  )
}

function shouldHandleVideoShortcut(
  target: EventTarget,
  currentTarget: HTMLDivElement
): boolean {
  if (target === currentTarget) return true
  if (!(target instanceof HTMLElement)) return false
  if (target.closest("[data-video-shortcut-scope='ignore']")) return false
  if (target.isContentEditable) return false

  const tag = target.tagName
  if (
    tag === "BUTTON" ||
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "TEXTAREA"
  ) {
    return false
  }

  const role = target.getAttribute("role")
  return role !== "slider" && role !== "button" && role !== "combobox"
}

/* ─── Chrome bar ───────────────────────────────────────────────────── */

export function ChromeBar({
  playing,
  duration,
  currentTime,
  bufferedEnd,
  muted,
  volume,
  autoAdvance,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onSeek,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
  onAutoAdvanceChange,
  onToggleFullscreen,
}: {
  playing: boolean
  duration: number
  currentTime: number
  bufferedEnd: number
  muted: boolean
  volume: number
  autoAdvance?: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (v: number) => void
  onSeek: (sec: number) => void
  qualityOptions?: Array<{
    id: string
    label: string
    detail?: string
    downloadUrl?: string
  }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  onAutoAdvanceChange?: (next: boolean) => void
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
        videoChromeBarClass,
        "pointer-events-auto absolute inset-x-0 -bottom-px isolate z-20 pb-px",
        "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "group-data-[chrome=hidden]/video:pointer-events-none group-data-[chrome=hidden]/video:opacity-0"
      )}
    >
      <div className="relative flex flex-col">
        <div className="flex flex-col gap-2 px-2.5 pt-2 pb-2">
          <div className="px-0.5">
            <VideoScrubber
              currentTime={currentTime}
              duration={duration}
              bufferedEnd={bufferedEnd}
              onSeek={onSeek}
            />
          </div>

          <div className="flex w-full items-center gap-1.5">
            <div className="inline-flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={playing ? "Pause" : "Play"}
                onClick={onTogglePlay}
                className={videoChromeIconClass}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </Button>

              <VolumeControl
                muted={muted}
                volume={volume}
                onToggleMute={onToggleMute}
                onVolumeChange={onVolumeChange}
                iconClassName={videoChromeIconClass}
              />
            </div>

            <div className="inline-flex items-center px-2 text-sm font-semibold text-foreground-faint tabular-nums">
              <span className="text-foreground">
                {formatTimeStable(currentTime, duration)}
              </span>
              <span className="mx-1 text-foreground-dim">/</span>
              <span>{formatTime(duration)}</span>
            </div>

            <div className="ml-auto inline-flex items-center gap-0.5">
              <VideoSettingsMenu
                qualityOptions={qualityOptions}
                selectedQualityId={selectedQualityId}
                onSelectQuality={onSelectQuality}
                triggerClassName={videoChromeIconClass}
              />

              {typeof autoAdvance === "boolean" ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    autoAdvance ? "Disable autoplay" : "Enable autoplay"
                  }
                  aria-pressed={autoAdvance}
                  onClick={() => onAutoAdvanceChange?.(!autoAdvance)}
                  className={cn(
                    videoChromeIconClass,
                    autoAdvance && "text-accent hover:text-accent"
                  )}
                >
                  <ListVideoIcon />
                </Button>
              ) : null}

              {fullscreenSupported ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  onClick={onToggleFullscreen}
                  className={videoChromeIconClass}
                >
                  <MaximizeIcon />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Load overlay ─────────────────────────────────────────────────── */

export function LoadOverlay({ status }: { status: LoadStatus }) {
  if (status.kind === "ready") return null
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 grid place-items-center",
        "text-center text-xs text-foreground-muted",
        status.kind === "loading" ? "bg-transparent" : ""
      )}
    >
      {status.kind === "loading" ? (
        <span className="grid size-10 place-items-center rounded-full border border-border-strong bg-surface-raised/95 shadow-md backdrop-blur-sm">
          <Spinner className="size-5" />
        </span>
      ) : (
        <span className="max-w-[80%] rounded-xl border border-border-strong bg-surface-raised/95 px-3 py-2 text-foreground shadow-md backdrop-blur-sm">
          {status.message}
        </span>
      )}
    </div>
  )
}
