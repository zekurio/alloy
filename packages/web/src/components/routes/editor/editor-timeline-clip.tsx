import { cn } from "@alloy/ui/lib/utils"
import { CloudIcon } from "lucide-react"
import * as React from "react"

import { formatTrimMs } from "@/lib/media-time"

import {
  clipDurationMs,
  clipEndMs,
  type EditorMediaSource,
  type TimelineClip,
} from "./editor-project"

/** Filmstrip cells rendered across the full span at zoom 1. */
const BASE_FILMSTRIP_CELLS = 24
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
  zoom,
  selected,
  onTrimKeyDown,
}: {
  clip: TimelineClip
  source: EditorMediaSource | null
  spanMs: number
  zoom: number
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
            "flex h-4 items-center gap-1 px-1.5 text-[10px] leading-none font-semibold",
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
          {source ? (
            <ClipFilmstrip
              clip={clip}
              source={source}
              zoom={zoom}
              spanMs={spanMs}
            />
          ) : null}
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
 * shows the sampled frame nearest to its center.
 */
function ClipFilmstrip({
  clip,
  source,
  spanMs,
  zoom,
}: {
  clip: TimelineClip
  source: EditorMediaSource
  spanMs: number
  zoom: number
}) {
  const rangeMs = clipDurationMs(clip)
  const frames = source.frames
  if (rangeMs <= 0 || source.durationMs <= 0 || frames.length === 0) {
    return <div className="size-full" />
  }
  const cellCount = Math.min(
    MAX_FILMSTRIP_CELLS,
    Math.max(1, Math.round((rangeMs / spanMs) * BASE_FILMSTRIP_CELLS * zoom)),
  )
  const cells: string[] = []
  for (let i = 0; i < cellCount; i++) {
    const sourceMs = clip.sourceStartMs + ((i + 0.5) / cellCount) * rangeMs
    const frameIndex = Math.min(
      frames.length - 1,
      Math.max(0, Math.floor((sourceMs / source.durationMs) * frames.length)),
    )
    cells.push(frames[frameIndex])
  }

  return (
    <div className="flex size-full">
      {cells.map((cell, i) => (
        <img
          key={i}
          src={cell}
          alt=""
          draggable={false}
          loading="lazy"
          className="h-full min-w-0 flex-1 object-cover"
          // A frame the desktop can't render (no ffmpeg) just leaves the
          // plain track background.
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden"
          }}
        />
      ))}
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
