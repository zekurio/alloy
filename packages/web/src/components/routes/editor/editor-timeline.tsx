import { cn } from "alloy-ui/lib/utils"
import { BlendIcon, CloudIcon, XIcon } from "lucide-react"
import * as React from "react"

import { formatTrimMs } from "@/lib/media-time"

import {
  clipDurationMs,
  clipEndMs,
  type EditorMediaSource,
  type EditorProject,
  type TimelineClip,
  trackJunctions,
  transitionBetween,
} from "./editor-project"

/**
 * Multitrack editing timeline: tracks render as stacked rows over a shared
 * ruler, clips sit at their timeline positions and can be dragged along the
 * time axis, across tracks, and trimmed at both edges. Clicking or dragging
 * empty space scrubs the playhead. The component is fully controlled — all
 * edits flow out through callbacks against the pure project model.
 */

/** Filmstrip cells rendered across the full span at zoom 1. */
const BASE_FILMSTRIP_CELLS = 24
/** Hard cap on filmstrip cells per clip (DOM size guard). */
const MAX_FILMSTRIP_CELLS = 240

export const MIN_TIMELINE_ZOOM = 1
export const MAX_TIMELINE_ZOOM = 16

export function clampTimelineZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_TIMELINE_ZOOM
  return Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, zoom))
}

type DragState =
  | { pointerId: number; mode: "seek" }
  | { pointerId: number; mode: "move"; clipId: string; grabOffsetMs: number }
  | { pointerId: number; mode: "trim-start" | "trim-end"; clipId: string }
  | {
      pointerId: number
      mode: "pan"
      startClientX: number
      startScrollLeft: number
    }

export function MultitrackTimeline({
  project,
  sources,
  spanMs,
  selectedClipId,
  currentMs,
  playing,
  zoom,
  onZoomChange,
  onSeek,
  onSelectClip,
  onMoveClip,
  onTrimClipStart,
  onTrimClipEnd,
  onToggleTransition,
  onRemoveTrack,
  onEditBegin,
  onEditCommit,
}: {
  project: EditorProject
  sources: Map<string, EditorMediaSource>
  /** Total time the scrollable strip covers; the timeline's spatial frame. */
  spanMs: number
  selectedClipId: string | null
  /** Playhead position in timeline time. */
  currentMs: number
  playing: boolean
  /** 1 = the span fits the viewport; larger values scroll horizontally. */
  zoom: number
  onZoomChange: (zoom: number) => void
  onSeek: (timelineMs: number) => void
  onSelectClip: (clipId: string | null) => void
  /** Live drag updates (the caller resolves collisions and clamps). */
  onMoveClip: (clipId: string, trackId: string, desiredStartMs: number) => void
  onTrimClipStart: (clipId: string, timelineMs: number) => void
  onTrimClipEnd: (clipId: string, timelineMs: number) => void
  /** Toggles a crossfade at the junction between two adjacent clips. */
  onToggleTransition: (leftClipId: string, rightClipId: string) => void
  /** Removes an empty track (the model refuses non-empty/last ones). */
  onRemoveTrack: (trackId: string) => void
  /** Bracket a drag interaction so the editor can snapshot undo history. */
  onEditBegin: () => void
  onEditCommit: () => void
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const trackAreaRef = React.useRef<HTMLDivElement | null>(null)
  const rowRefs = React.useRef(new Map<string, HTMLDivElement>())
  const dragRef = React.useRef<DragState | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const ready = spanMs > 0
  const innerPct = zoom * 100

  const timelineMsFromClientX = (clientX: number): number => {
    const rect = trackAreaRef.current?.getBoundingClientRect()
    if (!rect || !ready) return 0
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return pct * spanMs
  }

  const trackIdFromClientY = (clientY: number): string | null => {
    let best: string | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const [trackId, row] of rowRefs.current) {
      const rect = row.getBoundingClientRect()
      const distance =
        clientY < rect.top
          ? rect.top - clientY
          : clientY > rect.bottom
            ? clientY - rect.bottom
            : 0
      if (distance < bestDistance) {
        bestDistance = distance
        best = trackId
      }
    }
    return best
  }

  /* ── Zoom anchoring: keep the point under the cursor (or the viewport
        center) stationary when the zoom level changes. ── */
  const zoomAnchorRef = React.useRef<number | null>(null)
  const previousZoomRef = React.useRef(zoom)
  React.useLayoutEffect(() => {
    const scroller = scrollRef.current
    const previous = previousZoomRef.current
    previousZoomRef.current = zoom
    if (!scroller || previous === zoom) return
    const anchorClientX = zoomAnchorRef.current
    zoomAnchorRef.current = null
    const rect = scroller.getBoundingClientRect()
    const anchorOffset =
      anchorClientX !== null
        ? Math.min(rect.width, Math.max(0, anchorClientX - rect.left))
        : rect.width / 2
    const pointPx = scroller.scrollLeft + anchorOffset
    const scale = zoom / previous
    scroller.scrollLeft = pointPx * scale - anchorOffset
  }, [zoom])

  /* ── Ctrl/⌘ + wheel zooms; Shift + wheel pans the timeline horizontally.
        Plain wheel falls through to the parent's vertical track scroll.
        Attached natively because React wheel listeners can't preventDefault. ── */
  const wheelStateRef = React.useRef({ zoom, onZoomChange })
  wheelStateRef.current = { zoom, onZoomChange }
  React.useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent) => {
      const { zoom: currentZoom, onZoomChange: changeZoom } =
        wheelStateRef.current
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const factor = event.deltaY < 0 ? 1.25 : 0.8
        const next = clampTimelineZoom(currentZoom * factor)
        if (next !== currentZoom) {
          zoomAnchorRef.current = event.clientX
          changeZoom(next)
        }
        return
      }
      // Shift makes the wheel pan along the time axis. Browsers may surface a
      // shifted wheel as deltaX, so fall back to whichever axis moved.
      if (event.shiftKey && scroller.scrollWidth > scroller.clientWidth) {
        const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
        if (delta !== 0) {
          event.preventDefault()
          scroller.scrollLeft += delta
        }
      }
    }
    scroller.addEventListener("wheel", onWheel, { passive: false })
    return () => scroller.removeEventListener("wheel", onWheel)
  }, [])

  /* ── Keep the playhead in view while playing with the timeline zoomed. ── */
  React.useEffect(() => {
    if (!playing || !ready) return
    const scroller = scrollRef.current
    const trackArea = trackAreaRef.current
    if (!scroller || !trackArea) return
    const playheadPx = (currentMs / spanMs) * trackArea.clientWidth
    const margin = 12
    if (
      playheadPx < scroller.scrollLeft + margin ||
      playheadPx > scroller.scrollLeft + scroller.clientWidth - margin
    ) {
      scroller.scrollLeft = Math.max(
        0,
        playheadPx - scroller.clientWidth * 0.15,
      )
    }
  }, [playing, ready, currentMs, spanMs])

  const applyDrag = (drag: DragState, clientX: number, clientY: number) => {
    if (drag.mode === "pan") {
      const scroller = scrollRef.current
      if (scroller) {
        scroller.scrollLeft =
          drag.startScrollLeft - (clientX - drag.startClientX)
      }
      return
    }
    const timelineMs = timelineMsFromClientX(clientX)
    if (drag.mode === "seek") {
      onSeek(timelineMs)
      return
    }
    if (drag.mode === "move") {
      const trackId = trackIdFromClientY(clientY)
      if (trackId) {
        onMoveClip(drag.clipId, trackId, timelineMs - drag.grabOffsetMs)
      }
      return
    }
    if (drag.mode === "trim-start") onTrimClipStart(drag.clipId, timelineMs)
    else onTrimClipEnd(drag.clipId, timelineMs)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ready) return
    // Middle-button drag pans the (zoomed) timeline.
    if (e.button === 1) {
      e.preventDefault()
      const drag: DragState = {
        pointerId: e.pointerId,
        mode: "pan",
        startClientX: e.clientX,
        startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = drag
      setDragging(true)
      return
    }
    if (e.button !== 0) return
    const target = e.target as Element
    const playheadEl = target.closest<HTMLElement>("[data-playhead]")
    const handleEl = target.closest<HTMLElement>("[data-clip-handle]")
    const clipEl = target.closest<HTMLElement>("[data-clip-id]")
    const clipId = clipEl?.dataset.clipId ?? null

    let drag: DragState
    // A grabbed playhead only follows movement, so picking it up slightly
    // off-center never makes the position jump by the grab offset.
    let applyNow = true
    if (playheadEl) {
      drag = { pointerId: e.pointerId, mode: "seek" }
      applyNow = false
    } else if (handleEl && clipId) {
      const mode =
        handleEl.dataset.clipHandle === "start" ? "trim-start" : "trim-end"
      drag = { pointerId: e.pointerId, mode, clipId }
      onSelectClip(clipId)
      onEditBegin()
    } else if (clipId) {
      const clip = project.clips.find((entry) => entry.id === clipId)
      drag = {
        pointerId: e.pointerId,
        mode: "move",
        clipId,
        grabOffsetMs: clip
          ? timelineMsFromClientX(e.clientX) - clip.startMs
          : 0,
      }
      onSelectClip(clipId)
      onEditBegin()
    } else {
      // Ruler, empty track space, and gaps all scrub.
      drag = { pointerId: e.pointerId, mode: "seek" }
      onSelectClip(null)
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = drag
    setDragging(true)
    // Seeks apply immediately; clip drags only react to movement so a plain
    // click never nudges the clip.
    if (drag.mode === "seek" && applyNow) applyDrag(drag, e.clientX, e.clientY)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    applyDrag(drag, e.clientX, e.clientY)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDragging(false)
    if (drag.mode !== "seek" && drag.mode !== "pan") onEditCommit()
  }

  const handleTrimKeyDown =
    (clip: TimelineClip, edge: "start" | "end") =>
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!ready) return
      const stepMs = e.shiftKey ? 1000 : 100
      const apply = (deltaMs: number) => {
        e.preventDefault()
        e.stopPropagation()
        onEditBegin()
        if (edge === "start") {
          onTrimClipStart(clip.id, clip.startMs + deltaMs)
        } else {
          onTrimClipEnd(clip.id, clipEndMs(clip) + deltaMs)
        }
        onEditCommit()
      }
      if (e.key === "ArrowLeft") apply(-stepMs)
      else if (e.key === "ArrowRight") apply(stepMs)
    }

  return (
    <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden pb-1">
      {/* One pointer surface for the ruler and the tracks: scrubbing works
          from the ruler strip, the playhead handle, and any empty space. */}
      <div
        className={cn(
          "relative flex min-w-full touch-none flex-col gap-1 select-none",
          ready && (dragging ? "cursor-grabbing" : "cursor-pointer"),
        )}
        style={{ width: `${innerPct}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Sticky inside the page's vertical scroller, so the scrub strip
            and time reference survive scrolling a tall track list. */}
        <div className="bg-background sticky top-0 z-40">
          <TimelineRuler
            spanMs={spanMs}
            visibleMs={ready ? spanMs / zoom : 0}
            widthRatio={zoom}
          />
        </div>
        <div ref={trackAreaRef} className="relative flex flex-col gap-1">
          {project.tracks.map((track) => (
            <div
              key={track.id}
              ref={(node) => {
                if (node) rowRefs.current.set(track.id, node)
                else rowRefs.current.delete(track.id)
              }}
              data-track-row
              className="group/track border-border/60 bg-surface-raised/40 relative h-16 rounded-md border"
            >
              {/* Empty tracks (except the last one) can be removed. */}
              {project.tracks.length > 1 &&
              !project.clips.some((clip) => clip.trackId === track.id) ? (
                <button
                  type="button"
                  title={`Remove ${track.label}`}
                  aria-label={`Remove ${track.label}`}
                  className={cn(
                    "absolute top-1/2 left-2 z-20 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border transition-opacity",
                    "border-border bg-surface text-foreground-faint hover:border-border-strong hover:text-foreground",
                    "opacity-0 group-hover/track:opacity-100 focus-visible:opacity-100",
                    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  )}
                  // Keep the track area's drag machinery out of this click.
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onRemoveTrack(track.id)}
                >
                  <XIcon className="size-3" />
                </button>
              ) : null}
              {project.clips
                .filter((clip) => clip.trackId === track.id)
                .map((clip) => (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    source={sources.get(clip.sourceId) ?? null}
                    spanMs={spanMs}
                    zoom={zoom}
                    selected={selectedClipId === clip.id}
                    onTrimKeyDown={handleTrimKeyDown}
                  />
                ))}

              {/* Junction badges: adjacent clips can carry a crossfade. */}
              {trackJunctions(project, track.id).map(({ left, right }) => {
                const transition = transitionBetween(project, left.id, right.id)
                const label = transition ? "Remove crossfade" : "Add crossfade"
                return (
                  <button
                    key={`${left.id}:${right.id}`}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={transition !== null}
                    className={cn(
                      // Same layer as the trim handles; later in the DOM, so
                      // the badge wins the tie right at the junction.
                      "absolute top-1/2 z-20 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-colors",
                      "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                      transition
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border bg-surface text-foreground-faint hover:border-border-strong hover:text-foreground",
                    )}
                    style={{ left: `${(right.startMs / spanMs) * 100}%` }}
                    // Keep the track area's drag machinery out of this click.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onToggleTransition(left.id, right.id)}
                  >
                    <BlendIcon className="size-3" />
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Playhead: the line is decorative, the head in the ruler zone is
            a real grab handle with a generous hit area. */}
        {ready ? (
          <div
            // Above the sticky ruler so the head stays grabbable.
            className="pointer-events-none absolute inset-y-0 z-50"
            style={{
              left: `${Math.min(100, Math.max(0, (currentMs / spanMs) * 100))}%`,
            }}
          >
            <div
              aria-hidden
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]"
            />
            <div
              data-playhead
              role="slider"
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={Math.round(spanMs / 1000)}
              aria-valuenow={Math.round(currentMs / 1000)}
              aria-valuetext={formatTrimMs(currentMs)}
              tabIndex={0}
              onKeyDown={(e) => {
                const stepMs = e.shiftKey ? 1000 : 100
                if (e.key === "ArrowLeft") {
                  e.preventDefault()
                  e.stopPropagation()
                  onSeek(currentMs - stepMs)
                } else if (e.key === "ArrowRight") {
                  e.preventDefault()
                  e.stopPropagation()
                  onSeek(currentMs + stepMs)
                }
              }}
              className={cn(
                "pointer-events-auto absolute top-0.5 size-3.5 -translate-x-1/2 cursor-ew-resize rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]",
                // Widen the hit area well beyond the visible dot.
                "after:absolute after:-inset-2.5",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              )}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One clip at its timeline position: a label bar over a filmstrip of the
 * source range it plays, with trim handles on both edges. The whole block
 * is the move-drag surface.
 */
function ClipBlock({
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

/* ─── Ruler ────────────────────────────────────────────────────────── */

const RULER_INTERVALS_SEC = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800,
]

function rulerIntervalSec(visibleDurationSec: number): number {
  for (const interval of RULER_INTERVALS_SEC) {
    if (visibleDurationSec / interval <= 12) return interval
  }
  return 3600
}

function formatRulerSec(sec: number): string {
  const minutes = Math.floor(sec / 60)
  const seconds = sec % 60
  const wholeSeconds = Math.floor(seconds)
  const base = `${minutes}:${wholeSeconds.toString().padStart(2, "0")}`
  const fraction = Math.round((seconds - wholeSeconds) * 10)
  return fraction > 0 ? `${base}.${fraction}` : base
}

/**
 * Labels at major intervals over a dense strip of minor ticks. The interval
 * adapts to the visible (zoomed) time span so zooming in reveals finer
 * graduations.
 */
function TimelineRuler({
  spanMs,
  visibleMs,
  widthRatio,
}: {
  /** Total time the ruler strip covers (the scrollable track). */
  spanMs: number
  /** Time visible in the viewport at the current zoom. */
  visibleMs: number
  /** Strip width relative to the viewport (>= 1). */
  widthRatio: number
}) {
  const spanSec = spanMs / 1000
  if (spanSec <= 0 || visibleMs <= 0) return <div className="h-7" />

  const major = rulerIntervalSec(visibleMs / 1000)
  const minor = major / 10
  const tickCount = Math.min(2000, Math.floor(spanSec / minor))
  const ticks: Array<{ sec: number; kind: "major" | "mid" | "minor" }> = []
  for (let i = 0; i <= tickCount; i++) {
    ticks.push({
      sec: i * minor,
      kind: i % 10 === 0 ? "major" : i % 5 === 0 ? "mid" : "minor",
    })
  }
  // Label-edge fade thresholds shrink as the strip widens with zoom.
  const labelMinPct = 3 / widthRatio
  const labelMaxPct = 100 - 3.5 / widthRatio

  return (
    <div
      aria-hidden
      className="text-foreground-faint relative h-7 text-[10px] tabular-nums"
    >
      {ticks.map(({ sec, kind }) => {
        const pct = (sec / spanSec) * 100
        const showLabel =
          kind === "major" &&
          (sec === 0 || (pct > labelMinPct && pct < labelMaxPct))
        return (
          <div
            key={sec}
            className={cn(
              "absolute bottom-0 flex flex-col items-center justify-end gap-0.5",
              sec > 0 && "-translate-x-1/2",
            )}
            style={{ left: `${pct}%` }}
          >
            {showLabel ? (
              <span className="leading-none whitespace-nowrap">
                {formatRulerSec(sec)}
              </span>
            ) : null}
            <span
              className={cn(
                "w-px",
                kind === "major"
                  ? "bg-foreground-faint h-2"
                  : kind === "mid"
                    ? "bg-border h-1.5"
                    : "bg-border/60 h-1",
              )}
            />
          </div>
        )
      })}
    </div>
  )
}
