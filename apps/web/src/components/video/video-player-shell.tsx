import * as React from "react"
import { MaximizeIcon, PauseIcon, PlayIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { formatTime, formatTimeStable } from "./video-player-hooks"
import { VideoScrubber } from "./video-scrubber"
import { VideoSettingsMenu } from "./video-settings-menu"
import { VolumeControl } from "./video-volume-control"

const KEYBOARD_SEEK_SECONDS = 5
const KEYBOARD_VOLUME_STEP = 0.1

/* ─── Reusable video-chrome primitives ─────────────────────────────── */

/** Dark translucent bar background — use on any overlay bar sitting on
 *  top of video content. */
export const videoChromeBarClass =
  "group/bar bg-black/70 text-white transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-black/90"

/** Icon button style for controls sitting on video chrome. */
export const videoChromeIconClass =
  "size-8 rounded-full text-white hover:bg-white/10 focus-visible:ring-white/30 [&_svg]:size-[18px]"

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
  children,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  className?: string
  aspectRatio?: number
  playing: boolean
  onKeyCommand: VideoKeyCommand
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
  downloadOptions,
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
  qualityOptions?: Array<{ id: string; label: string }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  downloadOptions?: Array<{ id: string; label: string; url: string }>
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
        "pointer-events-auto absolute inset-x-0 bottom-0 isolate z-20",
        "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "group-data-[chrome=hidden]/video:pointer-events-none group-data-[chrome=hidden]/video:opacity-0"
      )}
    >
      <div className="relative flex flex-col">
        <div
          className={cn(
            videoChromeBarClass,
            "flex flex-col gap-1.5 px-2 pt-1.5 pb-1.5"
          )}
        >
          <div className="px-0.5 text-white">
            <VideoScrubber
              currentTime={currentTime}
              duration={duration}
              bufferedEnd={bufferedEnd}
              onSeek={onSeek}
            />
          </div>

          <div className="flex w-full items-center gap-1">
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

            <div className="inline-flex items-center px-2 text-sm font-semibold text-white/65 tabular-nums">
              <span className="text-white">{formatTimeStable(currentTime, duration)}</span>
              <span className="mx-1 text-white/35">/</span>
              <span>{formatTime(duration)}</span>
            </div>

            <div className="ml-auto inline-flex items-center gap-0.5">
              <VideoSettingsMenu
                qualityOptions={qualityOptions}
                selectedQualityId={selectedQualityId}
                onSelectQuality={onSelectQuality}
                downloadOptions={downloadOptions}
                autoAdvance={autoAdvance}
                onAutoAdvanceChange={onAutoAdvanceChange}
                triggerClassName={videoChromeIconClass}
                contentClassName="w-auto min-w-48 rounded-xl border border-white/10 bg-black/80 p-1 text-white shadow-lg ring-0 [&_*]:text-white [&_[data-slot=dropdown-menu-item]]:text-white/90 [&_[data-slot=dropdown-menu-item][data-highlighted]]:text-white [&_[data-slot=dropdown-menu-label]]:text-white/55 [&_[data-slot=dropdown-menu-radio-item]]:text-white/90 [&_[data-slot=dropdown-menu-radio-item][data-highlighted]]:text-white [&_[data-slot=dropdown-menu-sub-trigger]]:text-white/90 [&_[data-slot=dropdown-menu-sub-trigger][data-highlighted]]:text-white"
              />

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
        "text-center text-xs text-white/72",
        status.kind === "loading" ? "bg-transparent" : ""
      )}
    >
      {status.kind === "loading" ? (
        <span className="rounded-full border border-white/10 bg-black/70 px-3 py-1">
          Loading...
        </span>
      ) : (
        <span className="max-w-[80%] rounded-xl border border-white/10 bg-black/80 px-3 py-2 text-white">
          {status.message}
        </span>
      )}
    </div>
  )
}
