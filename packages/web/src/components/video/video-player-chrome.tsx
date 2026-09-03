import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@alloy/ui/components/drawer"
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
import {
  CheckIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import type { ComponentProps, RefObject } from "react"

import {
  mobileDrawerContentClass,
  MobileDrawerHandle,
} from "@/components/app/mobile-drawer-surface"
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
  onVolumeChangeEnd,
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
  onVolumeChangeEnd: () => void
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
    if (!globalThis.document) return
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
            onVolumeChangeEnd={onVolumeChangeEnd}
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
            isCoarsePointer={isCoarsePointer}
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
  onVolumeChangeEnd,
}: {
  size: ChromeBarSize
  playing: boolean
  muted: boolean
  volume: number
  isCoarsePointer: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (v: number) => void
  onVolumeChangeEnd: () => void
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
        onVolumeChangeEnd={onVolumeChangeEnd}
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
  isCoarsePointer,
  fullscreenSupported,
  isFullscreen,
  onToggleFullscreen,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
}: {
  size: ChromeBarSize
  portalContainer: HTMLDivElement | undefined
  isCoarsePointer: boolean
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
        <QualitySettingsControl
          size={size}
          sheet={isCoarsePointer}
          sheetContainer={isFullscreen ? portalContainer : undefined}
          popoverContainer={portalContainer}
          options={qualityOptions}
          selectedId={selectedQualityId}
          onSelect={onSelectQuality}
        />
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

function QualitySettingsControl({
  size,
  sheet,
  sheetContainer,
  popoverContainer,
  options,
  selectedId,
  onSelect,
}: {
  size: ChromeBarSize
  sheet: boolean
  sheetContainer: HTMLDivElement | undefined
  popoverContainer: HTMLDivElement | undefined
  options: QualityOption[]
  selectedId: string | undefined
  onSelect: (qualityId: string) => void
}) {
  if (sheet) {
    return (
      <Drawer direction="bottom">
        <DrawerTrigger asChild>
          <QualitySettingsButton size={size} />
        </DrawerTrigger>
        <DrawerContent
          container={sheetContainer}
          className={mobileDrawerContentClass}
        >
          <MobileDrawerHandle />
          <DrawerTitle className="px-4 pt-3 pb-2 text-base">
            {t("Playback quality")}
          </DrawerTitle>
          <div
            role="radiogroup"
            aria-label={t("Playback quality")}
            className="min-h-0 overflow-y-auto px-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {options.map((option) => (
              <DrawerClose key={option.id} asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={option.id === selectedId}
                  className="hover:bg-surface-raised focus-visible:ring-ring flex min-h-12 w-full items-center rounded-lg px-3 text-left text-sm outline-none focus-visible:ring-2"
                  onClick={() => onSelect(option.id)}
                >
                  <span>{option.label}</span>
                  {option.detail ? (
                    <span className="text-foreground-dim ml-auto pl-3 text-xs">
                      {option.detail}
                    </span>
                  ) : null}
                  {option.id === selectedId ? (
                    <CheckIcon className="text-accent ml-3 size-4 shrink-0" />
                  ) : null}
                </button>
              </DrawerClose>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<QualitySettingsButton size={size} />} />
      <DropdownMenuContent
        align="end"
        side="top"
        portalContainer={popoverContainer}
      >
        <DropdownMenuRadioGroup value={selectedId} onValueChange={onSelect}>
          {options.map((option) => (
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
  )
}

function QualitySettingsButton({
  size,
  className,
  ...props
}: { size: ChromeBarSize } & Omit<ComponentProps<typeof Button>, "size">) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("Playback quality")}
      className={cn(
        videoChromeIconClass,
        size === "compact" && "size-[56px]",
        className,
      )}
    >
      <SettingsIcon className={videoChromeGlyphClass} />
    </Button>
  )
}
