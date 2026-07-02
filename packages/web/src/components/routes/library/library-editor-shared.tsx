import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import {
  ArrowLeftIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react"
import { useSyncExternalStore } from "react"

import { formatTrimMs } from "@/lib/media-time"

import type { TrimPlayback } from "./use-trim-playback"

export function BackToLibraryButton() {
  return (
    <Button variant="secondary" render={<Link to="/library" />}>
      <ArrowLeftIcon />
      {t("Back to library")}
    </Button>
  )
}

/** Transport row above the trim bar: play/stop/reset plus the time readout. */
export function TrimTransportControls({
  playback,
}: {
  playback: TrimPlayback
}) {
  const { playing, trimmed, rangeMs, trim } = playback
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label={playing ? t("Pause (Space)") : t("Play (Space)")}
          title={playing ? t("Pause (Space)") : t("Play (Space)")}
          onClick={playback.togglePlayback}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("Stop")}
          title={t("Stop")}
          onClick={playback.stopPlayback}
        >
          <SquareIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("Reset trim")}
          title={t("Reset trim")}
          onClick={playback.resetTrim}
          disabled={!trimmed}
          className={cn(
            "text-foreground-faint hover:text-foreground transition-opacity",
            !trimmed && "pointer-events-none opacity-0",
          )}
        >
          <RotateCcwIcon />
        </Button>
      </div>
      <span className="text-foreground-muted text-sm tabular-nums">
        <TrimElapsed playback={playback} /> / {formatTrimMs(rangeMs)}
      </span>
      {trimmed ? (
        <span className="text-foreground-faint text-sm tabular-nums">
          {t("Trimmed to")}
          {formatTrimMs(trim.startMs)} {"–"}
          {formatTrimMs(trim.endMs)}
        </span>
      ) : null}
    </div>
  )
}

/** Leaf that follows the playhead store so only it re-renders per frame. */
function TrimElapsed({ playback }: { playback: TrimPlayback }) {
  const currentMs = useSyncExternalStore(
    playback.subscribeCurrentMs,
    playback.getCurrentMs,
  )
  const elapsedMs = Math.min(
    playback.rangeMs,
    Math.max(0, currentMs - playback.trim.startMs),
  )
  return formatTrimMs(elapsedMs)
}
