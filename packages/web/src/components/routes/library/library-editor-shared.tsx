import { Link } from "@tanstack/react-router"
import { Button } from "alloy-ui/components/button"
import { cn } from "alloy-ui/lib/utils"
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
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

/** Floating edge button mirroring the ←/→ hotkeys. */
export function CaptureNavButton({
  side,
  targetId,
}: {
  side: "left" | "right"
  targetId: string | null
}) {
  if (!targetId) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={side === "left" ? "Previous capture (←)" : "Next capture (→)"}
      title={side === "left" ? "Previous capture (←)" : "Next capture (→)"}
      className={cn(
        "absolute top-1/2 z-40 h-12 w-12 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white/70 shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:text-white hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]",
        side === "left" ? "left-2" : "right-2",
      )}
      render={
        <Link
          to="/library/$captureId"
          params={{ captureId: targetId }}
          // Replace history so the back arrow exits the editor rather than
          // stepping back through previously viewed captures.
          replace
        />
      }
    >
      {side === "left" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </Button>
  )
}
