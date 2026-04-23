import * as React from "react"
import { DownloadIcon, MaximizeIcon, PauseIcon, PlayIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@workspace/ui/components/select"

import { formatTime } from "./video-player-hooks"
import { VideoScrubber } from "./video-scrubber"
import { VolumeControl } from "./video-volume-control"

const KEYBOARD_SEEK_SECONDS = 5
const KEYBOARD_VOLUME_STEP = 0.1

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

function withVideoBackdrop(style: React.CSSProperties): React.CSSProperties {
  return {
    ...style,
    WebkitBackdropFilter: "blur(20px) saturate(1.5)",
    backdropFilter: "blur(20px) saturate(1.5)",
  }
}

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
  flush = false,
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
  /** Sit flush against the video frame — no padding / rounded corners. */
  flush?: boolean
}) {
  const [fullscreenSupported, setFullscreenSupported] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const glassStyle = {
    "--alloy-glass-hue": "var(--surface)",
    "--alloy-glass-opacity": "52%",
    "--alloy-glass-bg":
      "color-mix(in oklab, var(--surface) 52%, transparent)",
    "--alloy-glass-shadow": "0 18px 42px -28px rgb(0 0 0 / 0.82)",
  } as React.CSSProperties
  const iconButtonClass =
    "rounded-full text-white/90 hover:bg-white/10 hover:text-white focus-visible:ring-white/30"
  const selectTriggerClass =
    "h-8 gap-1 rounded-full border-0 bg-transparent pr-2 pl-2 text-xs text-white/90 hover:border-0 hover:bg-white/10 hover:text-white focus:ring-0 focus:ring-offset-0 focus-visible:border-0 focus-visible:bg-white/10 focus-visible:ring-0 [&_svg]:text-white/90 hover:[&_svg]:text-white [&_span]:text-white/90 hover:[&_span]:text-white"

  const hasQualityChoices =
    (qualityOptions?.length ?? 0) > 1 && Boolean(onSelectQuality)
  const hasDownloads = (downloadOptions?.length ?? 0) > 0
  const selectedQualityLabel =
    qualityOptions?.find((quality) => quality.id === selectedQualityId)?.label ??
    "Quality"

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

  const handleDownload = React.useCallback(() => {
    if (!downloadOptions?.length) return
    const url = downloadOptions[0].url
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.rel = "noopener"
    anchor.style.display = "none"
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }, [downloadOptions])

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
        className={cn(
          "relative flex flex-col",
          flush ? "px-0 pb-0" : "gap-2 px-3 pb-3 sm:px-4 sm:pb-4"
        )}
      >
        {flush ? null : (
          <div className="px-1 text-white">
            <VideoScrubber
              currentTime={currentTime}
              duration={duration}
              bufferedEnd={bufferedEnd}
              onSeek={onSeek}
            />
          </div>
        )}

        <div
          className={cn(
            "alloy-glass flex flex-col gap-1.5 px-1.5 text-white",
            flush
              ? "rounded-none border-x-0 border-b-0 border-t pt-1.5 pb-1"
              : "flex-row items-center rounded-2xl border py-1"
          )}
          style={withVideoBackdrop(glassStyle)}
        >
          {flush ? (
            <div className="px-0.5 text-white">
              <VideoScrubber
                currentTime={currentTime}
                duration={duration}
                bufferedEnd={bufferedEnd}
                onSeek={onSeek}
              />
            </div>
          ) : null}

          <div className="flex w-full items-center gap-1.5">
            <div className="inline-flex h-8 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={playing ? "Pause" : "Play"}
                onClick={onTogglePlay}
                className={iconButtonClass}
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

            <div className="inline-flex h-8 items-center px-2 text-xs text-white/65 tabular-nums">
              <span className="text-white/95">{formatTime(currentTime)}</span>
              <span className="mx-1 text-white/35">/</span>
              <span>{formatTime(duration)}</span>
            </div>

            <div className="ml-auto inline-flex h-8 items-center gap-0.5">
              {hasQualityChoices ? (
                <Select
                  value={selectedQualityId}
                  onValueChange={(value) => {
                    if (value) onSelectQuality?.(value)
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className={selectTriggerClass}
                  >
                    <span className="truncate">{selectedQualityLabel}</span>
                  </SelectTrigger>
                  <SelectContent
                    align="end"
                    sideOffset={6}
                    alignItemWithTrigger={false}
                    className="alloy-glass w-auto min-w-24 rounded-xl border border-white/10 bg-transparent p-1 text-white shadow-none ring-0 [&_*]:text-white [&_[data-slot=select-item]]:text-white/90 [&_[data-slot=select-item][data-highlighted]]:text-white [&_[data-slot=select-item][data-highlighted]_*]:text-white [&_[data-slot=select-item][data-selected]]:text-white [&_[data-slot=select-item][data-selected]_*]:text-white [&_[data-slot=select-item-indicator]]:text-white"
                    style={withVideoBackdrop(glassStyle)}
                  >
                    {qualityOptions?.map((quality) => (
                      <SelectItem
                        key={quality.id}
                        value={quality.id}
                        className="min-h-8 rounded-lg py-1.5 pr-8 pl-2.5 text-xs text-white/90 data-[selected=true]:bg-white/12 data-[selected=true]:text-white focus:bg-white/10 focus:text-white data-highlighted:bg-white/10 data-highlighted:text-white [&_span]:text-white/90 data-[selected=true]:[&_span]:text-white data-highlighted:[&_span]:text-white data-highlighted:[&_*]:text-white data-[selected=true]:[&_*]:text-white [&_svg]:text-white"
                      >
                        {quality.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {hasDownloads ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Download"
                  onClick={handleDownload}
                  className={iconButtonClass}
                >
                  <DownloadIcon />
                </Button>
              ) : null}

              {fullscreenSupported ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  onClick={onToggleFullscreen}
                  className={iconButtonClass}
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
          style={withVideoBackdrop({
            "--alloy-glass-hue": "var(--surface)",
            "--alloy-glass-opacity": "62%",
            "--alloy-glass-bg":
              "color-mix(in oklab, var(--surface) 62%, transparent)",
          } as React.CSSProperties)}
        >
          Loading...
        </span>
      ) : (
        <span
          className="alloy-glass max-w-[80%] rounded-xl border px-3 py-2 text-white"
          style={withVideoBackdrop({
            "--alloy-glass-hue": "var(--surface)",
            "--alloy-glass-opacity": "74%",
            "--alloy-glass-bg":
              "color-mix(in oklab, var(--surface) 74%, transparent)",
          } as React.CSSProperties)}
        >
          {status.message}
        </span>
      )}
    </div>
  )
}
