import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { FilmstripCanvas } from "@/components/media/filmstrip-canvas"
import { useFilmstripCellCount } from "@/lib/media-filmstrip"
import { formatTrimMs } from "@/lib/media-time"

/**
 * Simple single-range trimmer for the upload screen: a filmstrip of the
 * whole capture with one kept range styled like a selected clip block.
 * Dragging the block slides the trim window; dragging either edge resizes it.
 * Material outside the range stays visible but dimmed, clicking or dragging
 * the strip scrubs the playhead. Anything fancier (splits, multiple tracks)
 * lives in the full editor.
 */

/** Hard cap on filmstrip cells (DOM size guard). */
const MAX_FILMSTRIP_CELLS = 64
const TRIM_DRAG_THRESHOLD_PX = 4

type DragState =
  | { pointerId: number; mode: "seek" }
  | {
      pointerId: number
      mode: "pending-start" | "pending-end"
      seekMs: number
      startClientX: number
      startClientY: number
    }
  | { pointerId: number; mode: "start" | "end" }
  | {
      pointerId: number
      mode: "pending-move"
      grabOffsetMs: number
      seekMs: number
      startClientX: number
      startClientY: number
    }
  | { pointerId: number; mode: "move"; grabOffsetMs: number }

type PendingTrimDrag = Extract<
  DragState,
  { mode: "pending-start" | "pending-end" | "pending-move" }
>

function isPendingTrimDrag(drag: DragState): drag is PendingTrimDrag {
  return (
    drag.mode === "pending-start" ||
    drag.mode === "pending-end" ||
    drag.mode === "pending-move"
  )
}

function movedPastTrimThreshold(
  drag: PendingTrimDrag,
  clientX: number,
  clientY: number,
): boolean {
  return (
    Math.hypot(clientX - drag.startClientX, clientY - drag.startClientY) >=
    TRIM_DRAG_THRESHOLD_PX
  )
}

export function LibraryTrimBar({
  frames,
  frameAspect,
  durationMs,
  startMs,
  endMs,
  currentMs,
  onSeek,
  onStartChange,
  onEndChange,
  onMove,
}: {
  /** Frame image URLs sampled evenly across the source media. */
  frames: string[]
  /** Width/height ratio of the frames — cells size to match, never squish. */
  frameAspect: number
  durationMs: number
  startMs: number
  endMs: number
  /** Playhead position in source time. */
  currentMs: number
  onSeek: (sourceMs: number) => void
  /** Live trim-handle updates in absolute source time (caller clamps). */
  onStartChange: (sourceMs: number) => void
  onEndChange: (sourceMs: number) => void
  /** Slides the whole kept range to a new start (caller preserves length). */
  onMove: (sourceStartMs: number) => void
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const ready = durationMs > 0

  const sourceMsFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !ready) return 0
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return pct * durationMs
  }

  const applyDrag = (drag: DragState, clientX: number, clientY: number) => {
    const sourceMs = sourceMsFromClientX(clientX)
    if (drag.mode === "seek") onSeek(sourceMs)
    else if (isPendingTrimDrag(drag)) {
      if (!movedPastTrimThreshold(drag, clientX, clientY)) return
      const activeDrag =
        drag.mode === "pending-move"
          ? ({
              pointerId: drag.pointerId,
              mode: "move",
              grabOffsetMs: drag.grabOffsetMs,
            } satisfies DragState)
          : ({
              pointerId: drag.pointerId,
              mode: drag.mode === "pending-start" ? "start" : "end",
            } satisfies DragState)
      dragRef.current = activeDrag
      applyDrag(activeDrag, clientX, clientY)
    } else if (drag.mode === "start") onStartChange(sourceMs)
    else if (drag.mode === "end") onEndChange(sourceMs)
    else if (drag.mode === "move") onMove(sourceMs - drag.grabOffsetMs)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || e.button !== 0) return
    const target = e.target as Element
    const handleEl = target.closest<HTMLElement>("[data-trim-handle]")
    const drag: DragState = handleEl
      ? {
          pointerId: e.pointerId,
          mode:
            handleEl.dataset.trimHandle === "start"
              ? "pending-start"
              : "pending-end",
          seekMs: handleEl.dataset.trimHandle === "start" ? startMs : endMs,
          startClientX: e.clientX,
          startClientY: e.clientY,
        }
      : target.closest("[data-trim-move]")
        ? {
            pointerId: e.pointerId,
            mode: "pending-move",
            // Keep the grabbed spot under the pointer instead of snapping
            // the window start to it.
            grabOffsetMs: sourceMsFromClientX(e.clientX) - startMs,
            seekMs: sourceMsFromClientX(e.clientX),
            startClientX: e.clientX,
            startClientY: e.clientY,
          }
        : { pointerId: e.pointerId, mode: "seek" }
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = drag
    setDragging(true)
    // Seeks apply immediately; handle and move drags only react to movement
    // so grabbing never nudges the window by the grab offset.
    if (drag.mode === "seek") applyDrag(drag, e.clientX, e.clientY)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    applyDrag(drag, e.clientX, e.clientY)
  }

  const finishPointer = (
    e: React.PointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDragging(false)
    if (!cancelled && isPendingTrimDrag(drag)) onSeek(drag.seekMs)
  }

  const handleKeyDown =
    (edge: "start" | "end" | "move") =>
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!ready) return
      const stepMs = e.shiftKey ? 1000 : 100
      const apply = (deltaMs: number) => {
        e.preventDefault()
        e.stopPropagation()
        if (edge === "start") onStartChange(startMs + deltaMs)
        else if (edge === "end") onEndChange(endMs + deltaMs)
        else onMove(startMs + deltaMs)
      }
      if (e.key === "ArrowLeft") apply(-stepMs)
      else if (e.key === "ArrowRight") apply(stepMs)
    }

  const startPct = ready ? (startMs / durationMs) * 100 : 0
  const endPct = ready ? (endMs / durationMs) * 100 : 100

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-20 touch-none select-none",
        ready && (dragging ? "cursor-grabbing" : "cursor-pointer"),
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finishPointer(e)}
      onPointerCancel={(e) => finishPointer(e, true)}
    >
      <div className="bg-surface-raised absolute inset-x-0 top-4 bottom-0 overflow-hidden rounded-md">
        <FilmstripCells
          frames={frames}
          frameAspect={frameAspect}
          durationMs={durationMs}
        />
        {/* Cut-away material outside the kept range stays visible, dimmed,
            so the handles can always be dragged back out to recover it. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 bg-black/65"
          style={{ width: `${startPct}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 bg-black/65"
          style={{ width: `${Math.max(0, 100 - endPct)}%` }}
        />
      </div>

      {/* Kept range: a selected clip block over the full source strip. */}
      <div
        data-trim-move=""
        className={cn(
          "border-accent absolute inset-y-0 z-10 overflow-hidden rounded-md border-2",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          left: `${startPct}%`,
          width: `${Math.max(0, endPct - startPct)}%`,
        }}
      >
        <div
          role="slider"
          aria-label="Move trim window"
          aria-valuemin={0}
          aria-valuemax={Math.round(
            Math.max(0, durationMs - (endMs - startMs)) / 1000,
          )}
          aria-valuenow={Math.round(startMs / 1000)}
          aria-valuetext={`${formatTrimMs(startMs)} - ${formatTrimMs(endMs)}`}
          tabIndex={0}
          onKeyDown={handleKeyDown("move")}
          className="bg-accent text-accent-foreground focus-visible:ring-ring flex h-4 items-center gap-1 px-4 text-[10px] leading-none font-semibold focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="truncate">Trim selection</span>
          <span className="ml-auto shrink-0 tabular-nums opacity-80">
            {formatTrimMs(endMs - startMs)}
          </span>
        </div>
        <div
          data-trim-handle="start"
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs / 1000)}
          aria-valuenow={Math.round(startMs / 1000)}
          aria-valuetext={formatTrimMs(startMs)}
          tabIndex={0}
          onKeyDown={handleKeyDown("start")}
          className={trimHandleClass("left")}
        >
          <span className="bg-accent-foreground/80 h-5 w-0.5 rounded-full" />
        </div>
        <div
          data-trim-handle="end"
          role="slider"
          aria-label="Trim end"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs / 1000)}
          aria-valuenow={Math.round(endMs / 1000)}
          aria-valuetext={formatTrimMs(endMs)}
          tabIndex={0}
          onKeyDown={handleKeyDown("end")}
          className={trimHandleClass("right")}
        >
          <span className="bg-accent-foreground/80 h-5 w-0.5 rounded-full" />
        </div>
      </div>

      {ready ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-y-1 z-30"
          style={{
            left: `${Math.min(100, Math.max(0, (currentMs / durationMs) * 100))}%`,
          }}
        >
          <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
          <div className="absolute -top-1 size-2.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
        </div>
      ) : null}
    </div>
  )
}

function trimHandleClass(side: "left" | "right"): string {
  return cn(
    "bg-accent absolute inset-y-0 z-20 flex w-2.5 cursor-ew-resize items-center justify-center",
    side === "left" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
    // Widen the hit area beyond the visible grip for touch/precision.
    "after:absolute after:-inset-x-1.5 after:inset-y-0",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
  )
}

/**
 * Evenly spaced filmstrip cells covering the whole capture. The cell count
 * adapts to the strip's box so each cell keeps the frame aspect ratio.
 */
function FilmstripCells({
  frames,
  frameAspect,
  durationMs,
}: {
  frames: string[]
  frameAspect: number
  durationMs: number
}) {
  const stripRef = React.useRef<HTMLDivElement | null>(null)
  const cellCount = useFilmstripCellCount(
    stripRef,
    frameAspect,
    MAX_FILMSTRIP_CELLS,
    frames.length,
  )
  return (
    <div ref={stripRef} className="size-full">
      <FilmstripCanvas
        frames={frames}
        cellCount={cellCount}
        durationMs={durationMs}
      />
    </div>
  )
}
