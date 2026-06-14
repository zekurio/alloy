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

import { formatTrimMs } from "@/lib/media-time"

import type { TrimPlayback } from "./use-trim-playback"

export function BackToLibraryButton() {
  return (
    <Button variant="secondary" render={<Link to="/library" />}>
      <ArrowLeftIcon />
      Back to library
    </Button>
  )
}

/** Transport row above the trim bar: play/stop/reset plus the time readout. */
export function TrimTransportControls({
  playback,
}: {
  playback: TrimPlayback
}) {
  const { playing, trimmed, elapsedMs, rangeMs, trim } = playback
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label={playing ? "Pause (Space)" : "Play (Space)"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          onClick={playback.togglePlayback}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Stop"
          title="Stop"
          onClick={playback.stopPlayback}
        >
          <SquareIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Reset trim"
          title="Reset trim"
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
        {formatTrimMs(elapsedMs)} / {formatTrimMs(rangeMs)}
      </span>
      {trimmed ? (
        <span className="text-foreground-faint text-sm tabular-nums">
          Trimmed to {formatTrimMs(trim.startMs)} – {formatTrimMs(trim.endMs)}
        </span>
      ) : null}
    </div>
  )
}
