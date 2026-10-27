import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { MaximizeIcon, PauseIcon, PlayIcon } from "lucide-react"
import { memo } from "react"
import type { RefObject } from "react"

import { isFullscreenSupported } from "@/lib/fullscreen"

import { usePlayerState } from "./video-player-store"
import type { QualityOption } from "./video-player-types"
import { VideoScrubber } from "./video-scrubber"
import { VideoSettingsMenu } from "./video-settings-menu"
import { VolumeControl } from "./video-volume-control"

const videoChromeIconClass =
  "size-10 rounded-full text-white shadow-none hover:bg-transparent hover:text-white hover:shadow-none focus-visible:ring-ring"
const videoChromeGlyphClass =
  "size-[18px] stroke-[2] [filter:drop-shadow(0_0_1px_rgba(0,0,0,0.4))_drop-shadow(0_1px_2px_rgba(0,0,0,0.3))]"
/** Touch chrome keeps a 44px target: big enough for a thumb, small enough that
 *  the controls don't crowd a phone-width player. */
const videoChromeCompactIconClass = "size-11"

type ChromeBarSize = "default" | "compact"

/** Playback state comes from the enclosing player's store. */
export function ChromeBar({
  size = "default",
  containerRef,
  fullscreenContainer,
  isCoarsePointer,
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
  onPlaybackRateChange,
}: {
  size?: ChromeBarSize
  containerRef: RefObject<HTMLDivElement | null>
  /** The player container while it is the fullscreen element, else null. */
  fullscreenContainer: HTMLDivElement | null
  isCoarsePointer: boolean
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
  onPlaybackRateChange: (rate: number) => void
}) {
  const visible = usePlayerState((state) => state.chromeVisible)
  const isFullscreen = fullscreenContainer !== null

  return (
    <>
      {isCoarsePointer && !visible ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30">
          <ChromeTimeline onSeek={onSeek} variant="edge" />
        </div>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 isolate z-20 flex items-center gap-1 px-1 pt-2 pb-[env(safe-area-inset-bottom)] transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "bg-gradient-to-t from-black/85 via-black/25 to-transparent pt-7",
          visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          visible && "pointer-events-auto",
          isFullscreen &&
            "pr-[max(2px,calc(env(safe-area-inset-right)+2px))] pl-[max(2px,calc(env(safe-area-inset-left)+2px))]",
        )}
      >
        <div
          className={cn(
            "flex min-h-[60px] min-w-0 flex-1 items-center gap-1",
            size === "compact" && "min-h-[52px]",
          )}
        >
          <ChromeLeadingControls
            size={size}
            muted={muted}
            volume={volume}
            isCoarsePointer={isCoarsePointer}
            onTogglePlay={onTogglePlay}
            onToggleMute={onToggleMute}
            onVolumeChange={onVolumeChange}
            onVolumeChangeEnd={onVolumeChangeEnd}
          />

          <ChromeTimeline
            onSeek={onSeek}
            variant="translucent"
            expandHitArea={isCoarsePointer}
          />

          <ChromeTrailingControls
            size={size}
            popoverContainer={containerRef}
            sheetContainer={fullscreenContainer}
            isCoarsePointer={isCoarsePointer}
            fullscreenSupported={isFullscreenSupported()}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            qualityOptions={qualityOptions}
            selectedQualityId={selectedQualityId}
            onSelectQuality={onSelectQuality}
            onPlaybackRateChange={onPlaybackRateChange}
          />
        </div>
      </div>
    </>
  )
}

const ChromeLeadingControls = memo(function ChromeLeadingControls({
  size,
  muted,
  volume,
  isCoarsePointer,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onVolumeChangeEnd,
}: {
  size: ChromeBarSize
  muted: boolean
  volume: number
  isCoarsePointer: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (v: number) => void
  onVolumeChangeEnd: () => void
}) {
  const playing = usePlayerState((state) => state.playing)

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
          size === "compact" && videoChromeCompactIconClass,
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
          size === "compact" && videoChromeCompactIconClass,
        )}
      />
    </>
  )
})

/** The only part of the player that re-renders with the playback clock. */
const ChromeTimeline = memo(function ChromeTimeline({
  onSeek,
  variant,
  expandHitArea,
}: {
  onSeek: (sec: number) => void
  variant: "translucent" | "edge"
  expandHitArea?: boolean
}) {
  const currentTime = usePlayerState((state) => state.currentTime)
  const duration = usePlayerState((state) => state.duration)
  const bufferedEnd = usePlayerState((state) => state.bufferedEnd)
  const scrubber = (
    <VideoScrubber
      currentTime={currentTime}
      duration={duration}
      bufferedEnd={bufferedEnd}
      onSeek={onSeek}
      variant={variant}
      expandHitArea={expandHitArea}
    />
  )
  if (variant === "edge") return scrubber
  return <div className="min-w-0 flex-1 px-2">{scrubber}</div>
})

const ChromeTrailingControls = memo(function ChromeTrailingControls({
  size,
  popoverContainer,
  sheetContainer,
  isCoarsePointer,
  fullscreenSupported,
  isFullscreen,
  onToggleFullscreen,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
  onPlaybackRateChange,
}: {
  size: ChromeBarSize
  popoverContainer: RefObject<HTMLDivElement | null>
  sheetContainer: HTMLDivElement | null
  isCoarsePointer: boolean
  fullscreenSupported: boolean
  isFullscreen: boolean
  onToggleFullscreen: () => void
  qualityOptions: QualityOption[] | undefined
  selectedQualityId: string | undefined
  onSelectQuality: ((qualityId: string) => void) | undefined
  onPlaybackRateChange: (rate: number) => void
}) {
  const playbackRate = usePlayerState((state) => state.playbackRate)

  return (
    <>
      <VideoSettingsMenu
        sheet={isCoarsePointer}
        sheetContainer={sheetContainer}
        popoverContainer={popoverContainer}
        triggerClassName={cn(
          videoChromeIconClass,
          size === "compact" && videoChromeCompactIconClass,
        )}
        glyphClassName={videoChromeGlyphClass}
        qualityOptions={qualityOptions}
        selectedQualityId={selectedQualityId}
        onSelectQuality={onSelectQuality}
        playbackRate={playbackRate}
        onPlaybackRateChange={onPlaybackRateChange}
      />

      {fullscreenSupported ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isFullscreen ? t("Exit fullscreen") : t("Fullscreen")}
          onClick={onToggleFullscreen}
          className={cn(
            videoChromeIconClass,
            size === "compact" && videoChromeCompactIconClass,
          )}
        >
          <MaximizeIcon className={videoChromeGlyphClass} />
        </Button>
      ) : null}
    </>
  )
})
