import { cn } from "@alloy/ui/lib/utils"
import { CloudIcon } from "lucide-react"
import * as React from "react"

import { FilmstripCanvas } from "@/components/media/filmstrip-canvas"
import { useFilmstripCellCount, useMediaFilmstrip } from "@/lib/media-filmstrip"
import { formatTrimMs } from "@/lib/media-time"

import {
  clipDurationMs,
  clipEndMs,
  type EditorMediaSource,
  type TimelineClip,
} from "./editor-project"

/** Hard cap on filmstrip cells per clip (DOM size guard). */
const MAX_FILMSTRIP_CELLS = 240

/**
 * One clip at its timeline position: a label bar over a filmstrip of the
 * source range it plays, with trim handles on both edges. The whole block
 * is the move-drag surface.
 */
export function ClipBlock({
  clip,
  source,
  spanMs,
  selected,
  onTrimKeyDown,
}: {
  clip: TimelineClip
  source: EditorMediaSource | null
  spanMs: number
  selected: boolean
  onTrimKeyDown: (
    clip: TimelineClip,
    edge: "start" | "end",
  ) => (e: React.KeyboardEvent<HTMLDivElement>) => void
}) {
  const lengthMs = clipDurationMs(clip)
  if (lengthMs <= 0 || spanMs <= 0) return null
  const leftPct = (clip.startMs / spanMs) * 100
  const widthPct = (lengthMs / spanMs) * 100

  return (
    <div
      data-clip-id={clip.id}
      className="absolute inset-y-0"
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
    >
      <div
        className={cn(
          "absolute inset-0 cursor-grab overflow-hidden rounded-md border-2",
          selected ? "border-accent" : "border-border",
        )}
      >
        <div
          className={cn(
            "flex h-4 items-center gap-1 px-4 text-[10px] leading-none font-semibold",
            selected
              ? "bg-accent/80 text-accent-foreground"
              : "bg-surface-raised text-foreground-faint",
          )}
        >
          {source?.cloud ? (
            <CloudIcon
              aria-label="Uploaded clip"
              className="size-2.5 shrink-0"
            />
          ) : null}
          <span className="truncate">{clip.label}</span>
          <span className="ml-auto shrink-0 tabular-nums opacity-70">
            {formatTrimMs(lengthMs)}
          </span>
        </div>

        <div className="bg-surface-raised relative h-[calc(100%-1rem)]">
          {source ? <ClipFilmstrip clip={clip} source={source} /> : null}
        </div>
      </div>

      <div
        data-clip-handle="start"
        role="slider"
        aria-label={`${clip.label} start`}
        aria-valuemin={0}
        aria-valuemax={Math.round(spanMs / 1000)}
        aria-valuenow={Math.round(clip.startMs / 1000)}
        aria-valuetext={formatTrimMs(clip.startMs)}
        tabIndex={0}
        onKeyDown={onTrimKeyDown(clip, "start")}
        className={clipHandleClass(selected, "left")}
      >
        <span className="bg-accent-foreground/80 h-5 w-0.5 rounded-full" />
      </div>
      <div
        data-clip-handle="end"
        role="slider"
        aria-label={`${clip.label} end`}
        aria-valuemin={0}
        aria-valuemax={Math.round(spanMs / 1000)}
        aria-valuenow={Math.round(clipEndMs(clip) / 1000)}
        aria-valuetext={formatTrimMs(clipEndMs(clip))}
        tabIndex={0}
        onKeyDown={onTrimKeyDown(clip, "end")}
        className={clipHandleClass(selected, "right")}
      >
        <span className="bg-accent-foreground/80 h-5 w-0.5 rounded-full" />
      </div>
    </div>
  )
}

/**
 * Evenly spaced filmstrip cells covering the clip's source range. Each cell
 * shows the sampled frame nearest to its center. Frames decode in the
 * renderer via mediabunny, so local captures and uploaded clips look alike.
 */
function ClipFilmstrip({
  clip,
  source,
}: {
  clip: TimelineClip
  source: EditorMediaSource
}) {
  const {
    frames,
    aspect,
    durationMs: measuredMs,
  } = useMediaFilmstrip(source.mediaUrl)
  // The cell count tracks the block's on-screen box (which already factors
  // in zoom and window size), keeping every cell at the frame aspect ratio.
  const stripRef = React.useRef<HTMLDivElement | null>(null)
  const rangeMs = clipDurationMs(clip)
  // Frames were sampled across the measured duration; map cells against the
  // same value so they stay aligned when recorded metadata overshoots.
  const sourceDurationMs = measuredMs ?? source.durationMs
  const minCells =
    rangeMs > 0 && sourceDurationMs > 0 && frames.length > 0
      ? Math.ceil((rangeMs / sourceDurationMs) * frames.length)
      : 1
  const cellCount = useFilmstripCellCount(
    stripRef,
    aspect,
    MAX_FILMSTRIP_CELLS,
    minCells,
  )
  if (rangeMs <= 0 || sourceDurationMs <= 0 || frames.length === 0) {
    return <div ref={stripRef} className="size-full" />
  }

  return (
    <div ref={stripRef} className="size-full">
      <FilmstripCanvas
        frames={frames}
        cellCount={cellCount}
        durationMs={sourceDurationMs}
        startMs={clip.sourceStartMs}
        endMs={clip.sourceEndMs}
      />
    </div>
  )
}

function clipHandleClass(selected: boolean, side: "left" | "right"): string {
  return cn(
    "absolute inset-y-0 z-20 flex w-2.5 cursor-ew-resize items-center justify-center",
    side === "left" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
    selected ? "bg-accent" : "bg-border",
    // Widen the hit area beyond the visible grip for touch/precision.
    "after:absolute after:-inset-x-1.5 after:inset-y-0",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
  )
}
