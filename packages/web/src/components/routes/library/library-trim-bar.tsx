import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { formatTrimMs } from "@/lib/media-time"

/**
 * Simple single-range trimmer for the upload screen: a filmstrip of the
 * whole capture with one kept range between two trim handles. Material
 * outside the range stays visible but dimmed, clicking or dragging the
 * strip scrubs the playhead. Anything fancier (splits, multiple tracks)
 * lives in the full editor.
 */

const FILMSTRIP_CELLS = 16

type DragState =
  | { pointerId: number; mode: "seek" }
  | { pointerId: number; mode: "start" | "end" }

export function LibraryTrimBar({
  frames,
  durationMs,
  startMs,
  endMs,
  currentMs,
  onSeek,
  onStartChange,
  onEndChange,
}: {
  /** Frame image URLs sampled evenly across the source media. */
  frames: string[]
  durationMs: number
  startMs: number
  endMs: number
  /** Playhead position in source time. */
  currentMs: number
  onSeek: (sourceMs: number) => void
  /** Live trim-handle updates in absolute source time (caller clamps). */
  onStartChange: (sourceMs: number) => void
  onEndChange: (sourceMs: number) => void
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

  const applyDrag = (drag: DragState, clientX: number) => {
    const sourceMs = sourceMsFromClientX(clientX)
    if (drag.mode === "seek") onSeek(sourceMs)
    else if (drag.mode === "start") onStartChange(sourceMs)
    else onEndChange(sourceMs)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || e.button !== 0) return
    const handleEl = (e.target as Element).closest<HTMLElement>(
      "[data-trim-handle]",
    )
    const drag: DragState = handleEl
      ? {
          pointerId: e.pointerId,
          mode: handleEl.dataset.trimHandle === "start" ? "start" : "end",
        }
      : { pointerId: e.pointerId, mode: "seek" }
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = drag
    setDragging(true)
    // Seeks apply immediately; handle drags only react to movement so
    // grabbing a handle never nudges the edge by the grab offset.
    if (drag.mode === "seek") applyDrag(drag, e.clientX)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    applyDrag(drag, e.clientX)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDragging(false)
  }

  const handleKeyDown =
    (edge: "start" | "end") => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!ready) return
      const stepMs = e.shiftKey ? 1000 : 100
      const apply = (deltaMs: number) => {
        e.preventDefault()
        e.stopPropagation()
        if (edge === "start") onStartChange(startMs + deltaMs)
        else onEndChange(endMs + deltaMs)
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
        "relative h-16 touch-none select-none",
        ready && (dragging ? "cursor-grabbing" : "cursor-pointer"),
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="bg-surface-raised absolute inset-0 overflow-hidden rounded-lg">
        <FilmstripCells frames={frames} />
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

      {/* Kept-range frame with the trim handles on its edges. */}
      <div
        aria-hidden
        className="border-accent pointer-events-none absolute inset-y-0 rounded-lg border-2"
        style={{
          left: `${startPct}%`,
          width: `${Math.max(0, endPct - startPct)}%`,
        }}
      />
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
        style={{ left: `${startPct}%` }}
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
        style={{ left: `${endPct}%` }}
      >
        <span className="bg-accent-foreground/80 h-5 w-0.5 rounded-full" />
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
    side === "left" ? "rounded-l-lg" : "-translate-x-full rounded-r-lg",
    // Widen the hit area beyond the visible grip for touch/precision.
    "after:absolute after:-inset-x-1.5 after:inset-y-0",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
  )
}

/** Evenly spaced filmstrip cells covering the whole capture. */
function FilmstripCells({ frames }: { frames: string[] }) {
  if (frames.length === 0) return <div className="size-full" />
  const cells: string[] = []
  for (let i = 0; i < FILMSTRIP_CELLS; i++) {
    const frameIndex = Math.min(
      frames.length - 1,
      Math.floor((i / FILMSTRIP_CELLS) * frames.length),
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
