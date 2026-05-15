import * as React from "react"
import {
  ListVideoIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

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

export const videoChromeBarClass =
  "alloy-blur group/bar text-foreground rounded-2xl border border-white/8 [--alloy-blur-bg:rgb(8_8_10_/_0.82)] [--alloy-blur-blur:28px] [--alloy-blur-border:rgb(255_255_255_/_0.08)] [--alloy-blur-shadow:0_18px_48px_-20px_rgb(0_0_0_/_0.75)]"

export const videoChromeIconClass =
  "size-9 rounded-full text-foreground drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.5)] hover:bg-white/10 hover:text-foreground focus-visible:ring-ring [&_svg]:size-5"

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
  enableHorizontalSeekShortcuts = true,
  bar,
  barBelow = false,
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
  enableHorizontalSeekShortcuts?: boolean
  /** Chrome controls rendered inside the media viewport. */
  bar?: React.ReactNode
  /** When true, the bar is rendered as a sibling below the media frame
   *  instead of overlaying the video. */
  barBelow?: boolean
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
      handleVideoKeyCommand(e.nativeEvent, onKeyCommand, {
        enableHorizontalSeek: enableHorizontalSeekShortcuts,
      })
    },
    [enableHorizontalSeekShortcuts, onKeyCommand]
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
        "group/video relative isolate flex w-full flex-col overflow-hidden select-none",
        barBelow ? "bg-transparent" : "bg-black",
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
        {barBelow ? null : bar}
      </div>
      {barBelow ? bar : null}
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
  command: VideoKeyCommand,
  options: { enableHorizontalSeek?: boolean } = {}
): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false
  const key = e.key.toLowerCase()
  const enableHorizontalSeek = options.enableHorizontalSeek ?? true

  if (e.key === " " || e.code === "Space" || key === "k") {
    e.preventDefault()
    command.togglePlay()
    return true
  }
  if (enableHorizontalSeek && e.key === "ArrowLeft") {
    e.preventDefault()
    command.seekBy(-KEYBOARD_SEEK_SECONDS)
    return true
  }
  if (enableHorizontalSeek && e.key === "ArrowRight") {
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
  size = "default",
  containerRef,
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
  size?: "default" | "compact" | "minimal"
  containerRef: React.RefObject<HTMLDivElement | null>
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
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const settingsPortalContainer = isFullscreen
    ? containerRef.current
    : undefined

  React.useEffect(() => {
    if (typeof document === "undefined") return
    setFullscreenSupported(Boolean(document.fullscreenEnabled))
  }, [])

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    onChange()
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [containerRef])

  if (size === "minimal") {
    const MuteIcon =
      muted || volume === 0
        ? VolumeXIcon
        : volume < 0.5
          ? Volume1Icon
          : Volume2Icon
    return (
      <div
        className={cn("pointer-events-auto flex items-center gap-2 px-3 py-2")}
      >
        <div className="min-w-0 flex-1 px-1.5">
          <VideoScrubber
            currentTime={currentTime}
            duration={duration}
            bufferedEnd={bufferedEnd}
            onSeek={onSeek}
            variant="translucent"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={onToggleMute}
          className={cn(videoChromeIconClass, "size-9 [&_svg]:size-5")}
        >
          <MuteIcon />
        </Button>
      </div>
    )
  }

  return (
    <div
      aria-hidden={false}
      data-pinned={settingsOpen ? "true" : undefined}
      className={cn(
        videoChromeBarClass,
        "pointer-events-none absolute inset-x-3 bottom-3 isolate z-20 translate-y-1 opacity-0 transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "group-focus-within/video:pointer-events-auto group-focus-within/video:translate-y-0 group-focus-within/video:opacity-100",
        "group-hover/video:pointer-events-auto group-hover/video:translate-y-0 group-hover/video:opacity-100",
        "data-[pinned=true]:pointer-events-auto data-[pinned=true]:translate-y-0 data-[pinned=true]:opacity-100"
      )}
    >
      <div className="relative flex flex-col">
        <div
          className={cn(
            "flex flex-col px-2",
            size === "compact" ? "gap-1 px-2 pt-1 pb-1" : "gap-2 pt-2 pb-2"
          )}
        >
          <div className={cn(size === "compact" ? "px-2" : "px-0.5")}>
            <VideoScrubber
              currentTime={currentTime}
              duration={duration}
              bufferedEnd={bufferedEnd}
              onSeek={onSeek}
            />
          </div>

          <div className="flex w-full items-center gap-2">
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={playing ? "Pause" : "Play"}
                onClick={onTogglePlay}
                className={cn(
                  videoChromeIconClass,
                  size === "compact" && "size-10 [&_svg]:size-6"
                )}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </Button>

              {size === "compact" ? null : (
                <VolumeControl
                  muted={muted}
                  volume={volume}
                  onToggleMute={onToggleMute}
                  onVolumeChange={onVolumeChange}
                  iconClassName={videoChromeIconClass}
                />
              )}
            </div>

            <div
              className={cn(
                "inline-flex h-9 items-center px-2 text-sm leading-5 font-semibold text-foreground tabular-nums drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.5)]"
              )}
            >
              <span>{formatTimeStable(currentTime, duration)}</span>
              <span className="mx-1 text-foreground-muted">/</span>
              <span className="text-foreground-muted">
                {formatTime(duration)}
              </span>
            </div>

            <div className="ml-auto inline-flex items-center gap-1">
              <VideoSettingsMenu
                qualityOptions={qualityOptions}
                selectedQualityId={selectedQualityId}
                onSelectQuality={onSelectQuality}
                onOpenChange={setSettingsOpen}
                triggerClassName={cn(
                  videoChromeIconClass,
                  size === "compact" && "size-10 [&_svg]:size-6"
                )}
                portalContainer={settingsPortalContainer}
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
                    size === "compact" && "size-10 [&_svg]:size-6",
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
                  className={cn(
                    videoChromeIconClass,
                    size === "compact" && "size-10 [&_svg]:size-6"
                  )}
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
