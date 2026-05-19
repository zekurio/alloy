import * as React from "react"
import { MaximizeIcon, PauseIcon, PlayIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { useMediaQuery } from "@workspace/ui/hooks/use-media-query"
import { cn } from "@workspace/ui/lib/utils"

import { VideoScrubber } from "./video-scrubber"
import { VideoSettingsMenu } from "./video-settings-menu"
import { VolumeControl } from "./video-volume-control"
import {
  handleVideoKeyCommand,
  shouldHandleVideoShortcut,
  type VideoKeyCommand,
} from "./video-keyboard"

export {
  handleVideoKeyCommand,
  KEYBOARD_LONG_SEEK_SECONDS,
  shouldHandleGlobalVideoShortcut,
  type VideoKeyCommand,
} from "./video-keyboard"

/* ─── Reusable video-chrome primitives ─────────────────────────────── */

export const videoChromeIconClass =
  "size-[52px] rounded-full text-foreground shadow-none hover:bg-transparent hover:text-foreground hover:shadow-none focus-visible:ring-ring"

const videoChromeGlyphClass =
  "size-[18px] stroke-[1.8] drop-shadow-[0_0_6px_color-mix(in_oklab,var(--accent)_75%,transparent)]"
const compactVideoChromeGlyphClass =
  "size-[18px] stroke-[1.8] drop-shadow-[0_0_6px_color-mix(in_oklab,var(--accent)_75%,transparent)]"

/* ─── Types ────────────────────────────────────────────────────────── */

export type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }

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
        "relative isolate w-full overflow-hidden bg-[oklch(12%_0.01_250)]",
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
  onPointerMove,
  onPointerLeave,
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
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>
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
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      style={rootSizingStyle}
      className={cn(
        "group/video relative isolate flex w-full flex-col overflow-hidden select-none",
        barBelow ? "bg-transparent" : "bg-[oklch(12%_0.01_250)]",
        isFullscreen && "h-dvh w-dvw",
        maxDisplayHeight && !isFullscreen && "mx-auto",
        "focus:outline-none",
        className
      )}
    >
      <div
        data-slot="video-player-media"
        className={cn(
          "relative min-h-0 w-full overflow-hidden bg-[oklch(12%_0.01_250)]",
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

/* ─── Chrome bar ───────────────────────────────────────────────────── */

export function ChromeBar({
  size = "default",
  containerRef,
  visible = true,
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
  onToggleFullscreen,
}: {
  size?: "default" | "compact"
  containerRef: React.RefObject<HTMLDivElement | null>
  visible?: boolean
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
  qualityOptions?: Array<{
    id: string
    label: string
    detail?: string
    downloadUrl?: string
    selectable?: boolean
  }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  onToggleFullscreen: () => void
}) {
  const [fullscreenSupported, setFullscreenSupported] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const isCoarsePointer = useMediaQuery("(pointer: coarse)")
  const settingsPortalContainer = containerRef.current
  const chromeInteractive = visible || settingsOpen
  const showEdgeScrubber = isCoarsePointer
  const edgeScrubberInteractive = !visible && !settingsOpen

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

  return (
    <>
      {showEdgeScrubber && !chromeInteractive ? (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-30",
            edgeScrubberInteractive
              ? "pointer-events-auto"
              : "pointer-events-none"
          )}
        >
          <VideoScrubber
            currentTime={currentTime}
            duration={duration}
            bufferedEnd={bufferedEnd}
            onSeek={onSeek}
            variant="edge"
          />
        </div>
      ) : null}

      <div
        aria-hidden={false}
        data-pinned={settingsOpen ? "true" : undefined}
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 isolate z-20 flex items-center gap-1 px-1 pt-2 pb-[env(safe-area-inset-bottom)] transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-[oklch(12%_0.01_250)]/70",
          "bg-gradient-to-t from-black/70 via-black/30 to-transparent",
          visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          chromeInteractive && "pointer-events-auto",
          "data-[pinned=true]:translate-y-0 data-[pinned=true]:opacity-100",
          isFullscreen &&
            "pr-[max(2px,calc(env(safe-area-inset-right)+2px))] pl-[max(2px,calc(env(safe-area-inset-left)+2px))]"
        )}
      >
        <div
          className={cn(
            "flex min-h-[60px] min-w-0 flex-1 items-center gap-1",
            size === "compact" && "min-h-[64px] gap-1"
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
            className={cn(
              videoChromeIconClass,
              size === "compact" && "size-[56px]"
            )}
          >
            {playing ? (
              <PauseIcon
                className={cn(
                  videoChromeGlyphClass,
                  size === "compact" && compactVideoChromeGlyphClass
                )}
              />
            ) : (
              <PlayIcon
                className={cn(
                  videoChromeGlyphClass,
                  size === "compact" && compactVideoChromeGlyphClass
                )}
              />
            )}
          </Button>

          <VolumeControl
            muted={muted}
            volume={volume}
            onToggleMute={onToggleMute}
            onVolumeChange={onVolumeChange}
            showSlider={!isCoarsePointer}
            iconGlyphClassName={cn(
              videoChromeGlyphClass,
              size === "compact" && compactVideoChromeGlyphClass
            )}
            iconClassName={cn(
              videoChromeIconClass,
              size === "compact" && "size-[56px]"
            )}
          />

          <div className="min-w-0 flex-1 px-[2px]">
            <VideoScrubber
              currentTime={currentTime}
              duration={duration}
              bufferedEnd={bufferedEnd}
              onSeek={onSeek}
              variant="translucent"
            />
          </div>

          <VideoSettingsMenu
            qualityOptions={qualityOptions}
            selectedQualityId={selectedQualityId}
            onSelectQuality={onSelectQuality}
            onOpenChange={setSettingsOpen}
            triggerClassName={cn(
              videoChromeIconClass,
              size === "compact" && "size-[56px]"
            )}
            triggerIconClassName={cn(
              videoChromeGlyphClass,
              size === "compact" && compactVideoChromeGlyphClass
            )}
            portalContainer={settingsPortalContainer}
          />

          {fullscreenSupported ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={onToggleFullscreen}
              className={cn(
                videoChromeIconClass,
                size === "compact" && "size-[56px]"
              )}
            >
              <MaximizeIcon
                className={cn(
                  videoChromeGlyphClass,
                  size === "compact" && compactVideoChromeGlyphClass
                )}
              />
            </Button>
          ) : null}
        </div>
      </div>
    </>
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
