import * as React from "react"
import { MaximizeIcon, PauseIcon, PlayIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { useDocumentEvent } from "@workspace/ui/hooks/use-document-event"
import { useMediaQuery } from "@workspace/ui/hooks/use-media-query"
import { cn } from "@workspace/ui/lib/utils"

import { isFullscreenElement, isFullscreenSupported } from "@/lib/fullscreen"
import { VideoScrubber } from "./video-scrubber"
import { VideoSettingsMenu } from "./video-settings-menu"
import { VolumeControl } from "./video-volume-control"
import {
  handleVideoKeyCommand,
  shouldHandleVideoShortcut,
  type VideoKeyCommand,
} from "./video-keyboard"
import type { QualityOption } from "./video-player-types"

export {
  handleVideoKeyCommand,
  KEYBOARD_LONG_SEEK_SECONDS,
  shouldHandleGlobalVideoShortcut,
  type VideoKeyCommand,
} from "./video-keyboard"

/* ─── Reusable video-chrome primitives ─────────────────────────────── */

const videoChromeIconClass =
  "size-[52px] rounded-full text-foreground shadow-none hover:bg-transparent hover:text-foreground hover:shadow-none focus-visible:ring-ring"

// A soft dark drop-shadow keeps the white glyphs legible over bright video
// frames (e.g. a sunlit scene) where an accent-colored glow would just blend
// in. Two stacked shadows act as a gentle outline on every edge.
const videoChromeGlyphClass =
  "size-[18px] stroke-[2] [filter:drop-shadow(0_0_1px_rgba(0,0,0,0.4))_drop-shadow(0_1px_2px_rgba(0,0,0,0.3))]"
const compactVideoChromeGlyphClass = videoChromeGlyphClass

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
  const mediaSizingStyle = React.useMemo<
    React.CSSProperties | undefined
  >(() => {
    if (isFullscreen) return undefined
    // The shell owns the aspect-ratio so there is a single rounded box defining
    // the video area; the media frame simply fills it. Re-deriving the media
    // height from its own `aspect-ratio` would create a second, independently
    // rounded box that can disagree with the shell by a sub-pixel and leave a
    // thin gap between the video and the bottom chrome shadow.
    return { flex: "1 1 0", minHeight: 0 }
  }, [isFullscreen])
  const rootSizingStyle = React.useMemo(
    () => mediaShellSizingStyle(aspectRatio, maxDisplayHeight, isFullscreen),
    [aspectRatio, isFullscreen, maxDisplayHeight]
  )

  const onFullscreenChange = React.useCallback(() => {
    setIsFullscreen(isFullscreenElement(containerRef.current))
  }, [containerRef])

  React.useEffect(() => {
    onFullscreenChange()
  }, [onFullscreenChange])
  useDocumentEvent("fullscreenchange", onFullscreenChange)

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
        !aspectRatio && !isFullscreen && "aspect-video",
        maxDisplayHeight && !isFullscreen && "mx-auto",
        "focus:outline-none",
        className
      )}
    >
      <div
        data-slot="video-player-media"
        className={cn(
          "relative min-h-0 w-full overflow-hidden bg-[oklch(12%_0.01_250)]",
          isFullscreen && "flex-1"
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
  if (isFullscreen) return undefined
  if (!aspectRatio && !maxDisplayHeight) return undefined

  const style: React.CSSProperties = {}
  if (aspectRatio) style.aspectRatio = String(aspectRatio)

  if (maxDisplayHeight === "100%") {
    style.height = "100%"
    style.maxHeight = "100%"
    style.maxWidth = "100%"
    if (aspectRatio) {
      style.width = "auto"
      style.marginInline = "auto"
    }
    return style
  }

  if (maxDisplayHeight) {
    style.maxHeight = maxDisplayHeight
    if (aspectRatio) {
      style.width = `min(100%, calc(${maxDisplayHeight} * ${aspectRatio}))`
    }
    return style
  }

  // Aspect-ratio only: the shell derives its height from its own width, unless
  // the parent supplies an explicit height (e.g. the clip modal's `h-full`),
  // which then wins and the ratio is satisfied by the box it's placed in.
  return style
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
  qualityOptions?: QualityOption[]
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
    setFullscreenSupported(isFullscreenSupported())
  }, [])

  const onFullscreenChange = React.useCallback(() => {
    setIsFullscreen(isFullscreenElement(containerRef.current))
  }, [containerRef])

  React.useEffect(() => {
    onFullscreenChange()
  }, [onFullscreenChange])
  useDocumentEvent("fullscreenchange", onFullscreenChange)

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
          "bg-gradient-to-t from-black via-black/30 to-transparent pt-10",
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
