import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { Spinner } from "@alloy/ui/components/spinner"
import { useDocumentEvent } from "@alloy/ui/hooks/use-document-event"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import { cn } from "@alloy/ui/lib/utils"
import { MaximizeIcon, PauseIcon, PlayIcon, SettingsIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  CSSProperties,
  FocusEventHandler,
  KeyboardEvent,
  PointerEventHandler,
  ReactNode,
  RefObject,
} from "react"

import { isFullscreenElement, isFullscreenSupported } from "@/lib/fullscreen"

import {
  handleVideoKeyCommand,
  shouldHandleVideoShortcut,
  type VideoKeyCommand,
} from "./video-keyboard"
import type { QualityOption } from "./video-player-types"
import { VideoScrubber } from "./video-scrubber"
import { VolumeControl } from "./video-volume-control"

export {
  handleVideoKeyCommand,
  KEYBOARD_LONG_SEEK_SECONDS,
  shouldHandleGlobalVideoShortcut,
  type VideoKeyCommand,
} from "./video-keyboard"

/* ─── Reusable video-chrome primitives ─────────────────────────────── */

// The chrome glyphs always sit over the dark video frame / dark gradient, so
// they stay white regardless of the app theme. Using `text-foreground` here
// makes them flip to near-black in the light theme and vanish against the
// gradient.
const videoChromeIconClass =
  "size-10 rounded-full text-white shadow-none hover:bg-transparent hover:text-white hover:shadow-none focus-visible:ring-ring"

// A soft dark drop-shadow keeps the white glyphs legible over bright video
// frames (e.g. a sunlit scene) where an accent-colored glow would just blend
// in. Two stacked shadows act as a gentle outline on every edge.
const videoChromeGlyphClass =
  "size-[18px] stroke-[2] [filter:drop-shadow(0_0_1px_rgba(0,0,0,0.4))_drop-shadow(0_1px_2px_rgba(0,0,0,0.3))]"

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
  buffering = false,
  loadingLabel,
  aspectRatio,
  maxDisplayHeight,
  onPointerDown,
  onFocus,
  children,
}: {
  containerRef?: RefObject<HTMLDivElement | null>
  className?: string
  status: LoadStatus
  buffering?: boolean
  loadingLabel?: string
  aspectRatio?: number
  maxDisplayHeight?: string
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onFocus?: FocusEventHandler<HTMLDivElement>
  children: ReactNode
}) {
  const sizingStyle = useMemo(
    () => videoPlayerSizingStyle(aspectRatio, maxDisplayHeight),
    [aspectRatio, maxDisplayHeight],
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
        className,
      )}
      style={sizingStyle}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
    >
      {children}
      <LoadOverlay
        status={status}
        buffering={buffering}
        loadingLabel={loadingLabel}
      />
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
  containerRef: RefObject<HTMLDivElement | null>
  className?: string
  aspectRatio?: number
  maxDisplayHeight?: string
  playing: boolean
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerMove?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
  onFocus?: FocusEventHandler<HTMLDivElement>
  onKeyCommand: VideoKeyCommand
  enableHorizontalSeekShortcuts?: boolean
  /** Chrome controls rendered inside the media viewport. */
  bar?: ReactNode
  /** When true, the bar is rendered as a sibling below the media frame
   *  instead of overlaying the video. */
  barBelow?: boolean
  children: ReactNode
}) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mediaSizingStyle = useMemo<CSSProperties | undefined>(() => {
    if (isFullscreen) return undefined
    // The shell owns the aspect-ratio so there is a single rounded box defining
    // the video area; the media frame simply fills it. Re-deriving the media
    // height from its own `aspect-ratio` would create a second, independently
    // rounded box that can disagree with the shell by a sub-pixel and leave a
    // thin gap between the video and the bottom chrome shadow.
    return { flex: "1 1 0", minHeight: 0 }
  }, [isFullscreen])
  const rootSizingStyle = useMemo(
    () => mediaShellSizingStyle(aspectRatio, maxDisplayHeight, isFullscreen),
    [aspectRatio, isFullscreen, maxDisplayHeight],
  )

  const onFullscreenChange = useCallback(() => {
    setIsFullscreen(isFullscreenElement(containerRef.current))
  }, [containerRef])

  useEffect(() => {
    onFullscreenChange()
  }, [onFullscreenChange])
  useDocumentEvent("fullscreenchange", onFullscreenChange)

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!shouldHandleVideoShortcut(e.target, e.currentTarget)) return
      handleVideoKeyCommand(e.nativeEvent, onKeyCommand, {
        enableHorizontalSeek: enableHorizontalSeekShortcuts,
      })
    },
    [enableHorizontalSeekShortcuts, onKeyCommand],
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
        className,
      )}
    >
      <div
        data-slot="video-player-media"
        className={cn(
          "relative min-h-0 w-full overflow-hidden bg-[oklch(12%_0.01_250)]",
          isFullscreen && "flex-1",
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
  maxDisplayHeight: string | undefined,
): CSSProperties | undefined {
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
  isFullscreen: boolean,
): CSSProperties | undefined {
  if (isFullscreen) return undefined
  if (!aspectRatio && !maxDisplayHeight) return undefined

  const style: CSSProperties = {}
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
  onToggleFullscreen,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
}: {
  size?: "default" | "compact"
  containerRef: RefObject<HTMLDivElement | null>
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
  onToggleFullscreen: () => void
  qualityOptions?: QualityOption[]
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
}) {
  const [fullscreenSupported, setFullscreenSupported] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const isCoarsePointer = useMediaQuery("(pointer: coarse)")
  const chromeInteractive = visible
  const showEdgeScrubber = isCoarsePointer
  const edgeScrubberInteractive = !visible

  useEffect(() => {
    if (typeof document === "undefined") return
    setFullscreenSupported(isFullscreenSupported())
  }, [])

  const onFullscreenChange = useCallback(() => {
    setIsFullscreen(isFullscreenElement(containerRef.current))
  }, [containerRef])

  useEffect(() => {
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
              ? t("pointer-events-auto")
              : t("pointer-events-none"),
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
        data-pinned={undefined}
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 isolate z-20 flex items-center gap-1 px-1 pt-2 pb-[env(safe-area-inset-bottom)] transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "bg-gradient-to-t from-black via-black/30 to-transparent pt-10",
          visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          chromeInteractive && "pointer-events-auto",
          "data-[pinned=true]:translate-y-0 data-[pinned=true]:opacity-100",
          isFullscreen &&
            "pr-[max(2px,calc(env(safe-area-inset-right)+2px))] pl-[max(2px,calc(env(safe-area-inset-left)+2px))]",
        )}
      >
        <div
          className={cn(
            "flex min-h-[60px] min-w-0 flex-1 items-center gap-1",
            size === "compact" && "min-h-[64px]",
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? t("Pause") : t("Play")}
            onClick={onTogglePlay}
            className={cn(
              videoChromeIconClass,
              size === "compact" && "size-[56px]",
            )}
          >
            {playing ? (
              <PauseIcon className={videoChromeGlyphClass} />
            ) : (
              <PlayIcon className={videoChromeGlyphClass} />
            )}
          </Button>

          <VolumeControl
            muted={muted}
            volume={volume}
            onToggleMute={onToggleMute}
            onVolumeChange={onVolumeChange}
            showSlider={!isCoarsePointer}
            iconGlyphClassName={videoChromeGlyphClass}
            iconClassName={cn(
              videoChromeIconClass,
              size === "compact" && "size-[56px]",
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

          {qualityOptions && qualityOptions.length > 1 && onSelectQuality ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Playback quality")}
                    className={cn(
                      videoChromeIconClass,
                      size === "compact" && "size-[56px]",
                    )}
                  >
                    <SettingsIcon className={videoChromeGlyphClass} />
                  </Button>
                }
              />
              <DropdownMenuContent
                align="end"
                side="top"
                // Keep the menu inside the fullscreen element so it stays
                // visible while the player is fullscreen.
                portalContainer={containerRef.current ?? undefined}
              >
                <DropdownMenuRadioGroup
                  value={selectedQualityId}
                  onValueChange={onSelectQuality}
                >
                  {qualityOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id}>
                      {option.label}
                      {option.detail ? (
                        <span className="text-foreground-dim ml-auto pl-3 text-xs">
                          {option.detail}
                        </span>
                      ) : null}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {fullscreenSupported ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={isFullscreen ? t("Exit fullscreen") : t("Fullscreen")}
              onClick={onToggleFullscreen}
              className={cn(
                videoChromeIconClass,
                size === "compact" && "size-[56px]",
              )}
            >
              <MaximizeIcon className={videoChromeGlyphClass} />
            </Button>
          ) : null}
        </div>
      </div>
    </>
  )
}

/* ─── Load overlay ─────────────────────────────────────────────────── */

export function LoadOverlay({
  status,
  buffering = false,
  loadingLabel,
}: {
  status: LoadStatus
  buffering?: boolean
  loadingLabel?: string
}) {
  if (status.kind === "error") {
    return (
      <div className="text-foreground-muted pointer-events-none absolute inset-0 grid place-items-center text-center text-xs">
        <span className="border-border-strong bg-surface-raised/95 text-foreground max-w-[80%] rounded-xl border px-3 py-2 shadow-md backdrop-blur-sm">
          {status.message}
        </span>
      </div>
    )
  }
  if (status.kind === "ready" && !buffering) return null
  if (loadingLabel) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/10 text-center text-xs text-white">
        <span className="flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-2 shadow-lg backdrop-blur-md">
          <Spinner className="size-4" />
          <span>{loadingLabel}</span>
        </span>
      </div>
    )
  }
  return (
    <div className="text-foreground-muted pointer-events-none absolute inset-0 grid place-items-center bg-transparent text-center text-xs">
      <span className="grid size-10 place-items-center">
        <Spinner className="size-5" />
      </span>
    </div>
  )
}
