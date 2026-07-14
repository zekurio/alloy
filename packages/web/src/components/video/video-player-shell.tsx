import { Spinner } from "@alloy/ui/components/spinner"
import { useDocumentEvent } from "@alloy/ui/hooks/use-document-event"
import { cn } from "@alloy/ui/lib/utils"
import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  CSSProperties,
  FocusEventHandler,
  KeyboardEvent,
  PointerEventHandler,
  ReactNode,
  RefObject,
} from "react"

import { isFullscreenElement } from "@/lib/fullscreen"

import {
  handleVideoKeyCommand,
  shouldHandleVideoShortcut,
  type VideoKeyCommand,
} from "./video-keyboard"

export { ChromeBar } from "./video-player-chrome"

export {
  handleVideoKeyCommand,
  KEYBOARD_LONG_SEEK_SECONDS,
  shouldHandleGlobalVideoShortcut,
  type VideoKeyCommand,
} from "./video-keyboard"

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
