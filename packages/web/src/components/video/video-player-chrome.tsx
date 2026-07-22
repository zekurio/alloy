import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { useDocumentEvent } from "@alloy/ui/hooks/use-document-event"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import { cn } from "@alloy/ui/lib/utils"
import { MaximizeIcon, PauseIcon, PlayIcon, SettingsIcon } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import type { RefObject } from "react"

import { isFullscreenElement, isFullscreenSupported } from "@/lib/fullscreen"

import type { QualityOption } from "./video-player-types"
import { VideoScrubber } from "./video-scrubber"
import { VolumeControl } from "./video-volume-control"

const videoChromeIconClass =
  "size-10 rounded-full text-white shadow-none hover:bg-transparent hover:text-white hover:shadow-none focus-visible:ring-ring"
const videoChromeGlyphClass =
  "size-[18px] stroke-[2] [filter:drop-shadow(0_0_1px_rgba(0,0,0,0.4))_drop-shadow(0_1px_2px_rgba(0,0,0,0.3))]"

type ChromeBarSize = "default" | "compact"

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
  size?: ChromeBarSize
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
  const portalContainer = containerRef.current ?? undefined

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
      {isCoarsePointer && !visible ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30">
          <ChromeTimeline
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
          visible && "pointer-events-auto",
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
          <ChromeLeadingControls
            size={size}
            playing={playing}
            muted={muted}
            volume={volume}
            isCoarsePointer={isCoarsePointer}
            onTogglePlay={onTogglePlay}
            onToggleMute={onToggleMute}
            onVolumeChange={onVolumeChange}
          />

          <ChromeTimeline
            currentTime={currentTime}
            duration={duration}
            bufferedEnd={bufferedEnd}
            onSeek={onSeek}
            variant="translucent"
          />

          <ChromeTrailingControls
            size={size}
            portalContainer={portalContainer}
            fullscreenSupported={fullscreenSupported}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            qualityOptions={qualityOptions}
            selectedQualityId={selectedQualityId}
            onSelectQuality={onSelectQuality}
          />
        </div>
      </div>
    </>
  )
}

const ChromeLeadingControls = memo(function ChromeLeadingControls({
  size,
  playing,
  muted,
  volume,
  isCoarsePointer,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
}: {
  size: ChromeBarSize
  playing: boolean
  muted: boolean
  volume: number
  isCoarsePointer: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (v: number) => void
}) {
  return (
    <>
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
    </>
  )
})

const ChromeTimeline = memo(function ChromeTimeline({
  currentTime,
  duration,
  bufferedEnd,
  onSeek,
  variant,
}: {
  currentTime: number
  duration: number
  bufferedEnd: number
  onSeek: (sec: number) => void
  variant: "translucent" | "edge"
}) {
  const scrubber = (
    <VideoScrubber
      currentTime={currentTime}
      duration={duration}
      bufferedEnd={bufferedEnd}
      onSeek={onSeek}
      variant={variant}
    />
  )
  if (variant === "edge") return scrubber
  return <div className="min-w-0 flex-1 px-[2px]">{scrubber}</div>
})

const ChromeTrailingControls = memo(function ChromeTrailingControls({
  size,
  portalContainer,
  fullscreenSupported,
  isFullscreen,
  onToggleFullscreen,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
}: {
  size: ChromeBarSize
  portalContainer: HTMLDivElement | undefined
  fullscreenSupported: boolean
  isFullscreen: boolean
  onToggleFullscreen: () => void
  qualityOptions: QualityOption[] | undefined
  selectedQualityId: string | undefined
  onSelectQuality: ((qualityId: string) => void) | undefined
}) {
  return (
    <>
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
            portalContainer={portalContainer}
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
    </>
  )
})
