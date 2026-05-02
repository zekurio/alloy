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
export const KEYBOARD_LONG_SEEK_SECONDS = 10
const KEYBOARD_VOLUME_STEP = 0.1

/* ─── Reusable video-chrome primitives ─────────────────────────────── */

/** App-surface bar background for player chrome. */
export const videoChromeBarClass =
  "group/bar border-t border-border/70 bg-surface-raised text-foreground shadow-[var(--shadow-inset-top)]"

/** Icon button style for controls sitting on video chrome. */
export const videoChromeIconClass =
  "size-9 rounded-full text-foreground-muted hover:bg-neutral-150 hover:text-foreground focus-visible:ring-ring [&_svg]:size-5"

/* ─── Types ────────────────────────────────────────────────────────── */

export type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }

export type VideoKeyCommand = {
  togglePlay: () => void
  toggleMute: () => void
  seekBy: (delta: number) => void
  seekTo: (seconds: number) => void
  seekPercent: (percent: number) => void
  volumeBy: (delta: number) => void
  toggleFullscreen: () => void
}

/* ─── Shells ───────────────────────────────────────────────────────── */

export function BareShell({
  containerRef,
  className,
  status,
  aspectRatio,
  maxDisplayHeight,
  onPointerDown,
  onFocus,
  children,
}: {
  containerRef?: React.RefObject<HTMLDivElement | null>
  className?: string
  status: LoadStatus
  aspectRatio?: number
  maxDisplayHeight?: string
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onFocus?: React.FocusEventHandler<HTMLDivElement>
  children: React.ReactNode
}) {
  const sizingStyle = React.useMemo(
    () => videoPlayerSizingStyle(aspectRatio, maxDisplayHeight),
    [aspectRatio, maxDisplayHeight]
  )

  return (
    <div
      ref={containerRef}
      data-slot="video-player"
      data-mode="bare"
      tabIndex={-1}
      className={cn(
        "relative isolate w-full overflow-hidden bg-black",
        maxDisplayHeight && "mx-auto",
        !aspectRatio && "aspect-video",
        "focus:outline-none",
        className
      )}
      style={sizingStyle}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
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
  maxDisplayHeight,
  playing,
  onPointerDown,
  onFocus,
  onKeyCommand,
  bar,
  children,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  className?: string
  aspectRatio?: number
  maxDisplayHeight?: string
  playing: boolean
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onFocus?: React.FocusEventHandler<HTMLDivElement>
  onKeyCommand: VideoKeyCommand
  /** Chrome controls rendered as their own layout row under the media viewport. */
  bar?: React.ReactNode
  children: React.ReactNode
}) {
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const isFillParent = maxDisplayHeight === "100%"
  const mediaSizingStyle = React.useMemo(() => {
    if (isFullscreen) return undefined
    if (isFillParent) {
      // Outer shell carries the aspect-ratio in fill mode; inner just grows
      // to fill the remaining space above the chrome bar.
      return { flex: "1 1 0", minHeight: 0 }
    }
    return videoPlayerSizingStyle(aspectRatio, maxDisplayHeight)
  }, [aspectRatio, isFillParent, isFullscreen, maxDisplayHeight])
  const rootSizingStyle = React.useMemo(
    () => mediaShellSizingStyle(aspectRatio, maxDisplayHeight, isFullscreen),
    [aspectRatio, isFullscreen, maxDisplayHeight]
  )

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
      handleVideoKeyCommand(e.nativeEvent, onKeyCommand)
    },
    [onKeyCommand]
  )

  return (
    <div
      ref={containerRef}
      data-slot="video-player"
      data-mode="chrome"
      data-playing={playing ? "true" : "false"}
      data-chrome="visible"
      data-fullscreen={isFullscreen ? "true" : "false"}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      style={rootSizingStyle}
      className={cn(
        "group/video relative isolate flex w-full flex-col overflow-hidden bg-black select-none",
        isFullscreen && "h-dvh w-dvw",
        maxDisplayHeight && !isFullscreen && "mx-auto",
        "focus:outline-none",
        className
      )}
    >
      <div
        data-slot="video-player-media"
        className={cn(
          "relative min-h-0 w-full overflow-hidden bg-black",
          isFullscreen ? "flex-1" : !aspectRatio && "aspect-video"
        )}
        style={mediaSizingStyle}
      >
        <div data-slot="video-player-frame" className="absolute inset-0">
          {children}
        </div>
      </div>
      {bar}
    </div>
  )
}

function videoPlayerSizingStyle(
  aspectRatio: number | undefined,
  maxDisplayHeight: string | undefined
): React.CSSProperties | undefined {
  if (!aspectRatio && !maxDisplayHeight) return undefined
  if (!maxDisplayHeight) {
    return aspectRatio ? { aspectRatio: String(aspectRatio) } : undefined
  }

  if (maxDisplayHeight === "100%") {
    // Fill-parent mode: the player sizes itself from the flex parent's
    // remaining height, preserving aspect ratio. No fixed pixel reservation,
    // so siblings (description, tags) can grow naturally without forcing
    // the player to shrink in width or triggering meta scrollbars.
    if (!aspectRatio) {
      return { maxHeight: "100%", maxWidth: "100%" }
    }
    return {
      aspectRatio: String(aspectRatio),
      height: "100%",
      width: "auto",
      maxHeight: "100%",
      maxWidth: "100%",
      marginInline: "auto",
    }
  }

  return {
    ...(aspectRatio ? { aspectRatio: String(aspectRatio) } : {}),
    maxHeight: maxDisplayHeight,
    width: aspectRatio
      ? `min(100%, calc(${maxDisplayHeight} * ${aspectRatio}))`
      : undefined,
  }
}

function mediaShellSizingStyle(
  aspectRatio: number | undefined,
  maxDisplayHeight: string | undefined,
  isFullscreen: boolean
): React.CSSProperties | undefined {
  if (isFullscreen || !maxDisplayHeight) return undefined
  if (maxDisplayHeight === "100%") {
    if (!aspectRatio) {
      return { height: "100%", maxHeight: "100%", maxWidth: "100%" }
    }
    return {
      aspectRatio: String(aspectRatio),
      height: "100%",
      width: "auto",
      maxHeight: "100%",
      maxWidth: "100%",
      marginInline: "auto",
    }
  }
  if (!aspectRatio) return undefined
  return {
    width: `min(100%, calc(${maxDisplayHeight} * ${aspectRatio}))`,
  }
}

export function shouldHandleVideoShortcut(
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

export function shouldHandleGlobalVideoShortcut(
  target: EventTarget | null,
  playerRoot: HTMLElement | null
) {
  if (!(target instanceof HTMLElement)) return true
  if (target.closest("[data-video-shortcut-scope='ignore']")) return false
  if (target.isContentEditable) return false

  const tag = target.tagName
  if (
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "TEXTAREA" ||
    tag === "A"
  ) {
    return false
  }

  const isPlayerControl = Boolean(
    playerRoot?.contains(target) ||
    target.closest("[data-video-player-control]")
  )

  if (tag === "BUTTON" && !isPlayerControl) return false

  const role = target.getAttribute("role")
  if (role === "slider" || role === "combobox") return false
  return role !== "button" || isPlayerControl
}

export function handleVideoKeyCommand(
  e: KeyboardEvent,
  command: VideoKeyCommand
): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false
  const key = e.key.toLowerCase()

  if (e.key === " " || e.code === "Space" || key === "k") {
    e.preventDefault()
    command.togglePlay()
    return true
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault()
    command.seekBy(-KEYBOARD_SEEK_SECONDS)
    return true
  }
  if (e.key === "ArrowRight") {
    e.preventDefault()
    command.seekBy(KEYBOARD_SEEK_SECONDS)
    return true
  }
  if (key === "j") {
    e.preventDefault()
    command.seekBy(-KEYBOARD_LONG_SEEK_SECONDS)
    return true
  }
  if (key === "l") {
    e.preventDefault()
    command.seekBy(KEYBOARD_LONG_SEEK_SECONDS)
    return true
  }
  if (e.key === "ArrowUp") {
    e.preventDefault()
    command.volumeBy(KEYBOARD_VOLUME_STEP)
    return true
  }
  if (e.key === "ArrowDown") {
    e.preventDefault()
    command.volumeBy(-KEYBOARD_VOLUME_STEP)
    return true
  }
  if (e.key === "Home") {
    e.preventDefault()
    command.seekTo(0)
    return true
  }
  if (e.key === "End") {
    e.preventDefault()
    command.seekTo(Number.POSITIVE_INFINITY)
    return true
  }
  if (/^[0-9]$/.test(key)) {
    e.preventDefault()
    command.seekPercent(Number(key) / 10)
    return true
  }
  if (key === "m") {
    e.preventDefault()
    command.toggleMute()
    return true
  }
  if (key === "f") {
    e.preventDefault()
    command.toggleFullscreen()
    return true
  }

  return false
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
        "pointer-events-auto relative isolate z-20 shrink-0"
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
