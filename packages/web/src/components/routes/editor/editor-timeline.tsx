import { cn } from "@alloy/ui/lib/utils"
import { BlendIcon, XIcon } from "lucide-react"
import * as React from "react"

import { formatTrimMs } from "@/lib/media-time"

import {
  clipEndMs,
  type EditorMediaSource,
  type EditorProject,
  type TimelineClip,
  trackJunctions,
  transitionBetween,
} from "./editor-project"
import { ClipBlock } from "./editor-timeline-clip"
import { TimelineRuler } from "./editor-timeline-ruler"

/**
 * Multitrack editing timeline: tracks render as stacked rows over a shared
 * ruler, clips sit at their timeline positions and can be dragged along the
 * time axis, across tracks, and trimmed at both edges. Clicking the timeline
 * seeks the playhead, while dragging edits clips. The component is fully
 * controlled — all
 * edits flow out through callbacks against the pure project model.
 */

export const MIN_TIMELINE_ZOOM = 1
export const MAX_TIMELINE_ZOOM = 16
const EDIT_DRAG_THRESHOLD_PX = 4

export function clampTimelineZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_TIMELINE_ZOOM
  return Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, zoom))
}

type DragState =
  | { pointerId: number; mode: "seek" }
  | {
      pointerId: number
      mode: "pending-move"
      clipId: string
      grabOffsetMs: number
      seekMs: number
      startClientX: number
      startClientY: number
    }
  | { pointerId: number; mode: "move"; clipId: string; grabOffsetMs: number }
  | {
      pointerId: number
      mode: "pending-trim-start" | "pending-trim-end"
      clipId: string
      seekMs: number
      startClientX: number
      startClientY: number
    }
  | { pointerId: number; mode: "trim-start" | "trim-end"; clipId: string }
  | {
      pointerId: number
      mode: "pan"
      startClientX: number
      startScrollLeft: number
    }

type PendingEditDrag = Extract<
  DragState,
  {
    mode: "pending-move" | "pending-trim-start" | "pending-trim-end"
  }
>

function isPendingEditDrag(drag: DragState): drag is PendingEditDrag {
  return (
    drag.mode === "pending-move" ||
    drag.mode === "pending-trim-start" ||
    drag.mode === "pending-trim-end"
  )
}

function movedPastEditThreshold(
  drag: PendingEditDrag,
  clientX: number,
  clientY: number,
): boolean {
  return (
    Math.hypot(clientX - drag.startClientX, clientY - drag.startClientY) >=
    EDIT_DRAG_THRESHOLD_PX
  )
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
    if (isPendingEditDrag(drag)) {
      if (!movedPastEditThreshold(drag, clientX, clientY)) return
      const activeDrag =
        drag.mode === "pending-move"
          ? ({
              pointerId: drag.pointerId,
              mode: "move",
              clipId: drag.clipId,
              grabOffsetMs: drag.grabOffsetMs,
            } satisfies DragState)
          : ({
              pointerId: drag.pointerId,
              mode:
                drag.mode === "pending-trim-start" ? "trim-start" : "trim-end",
              clipId: drag.clipId,
            } satisfies DragState)
      dragRef.current = activeDrag
      onEditBegin()
      applyDrag(activeDrag, clientX, clientY)
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
      const clip = project.clips.find((entry) => entry.id === clipId)
      const startHandle = handleEl.dataset.clipHandle === "start"
      drag = {
        pointerId: e.pointerId,
        mode: startHandle ? "pending-trim-start" : "pending-trim-end",
        clipId,
        seekMs: clip ? (startHandle ? clip.startMs : clipEndMs(clip)) : 0,
        startClientX: e.clientX,
        startClientY: e.clientY,
      }
      onSelectClip(clipId)
    } else if (clipId) {
      const clip = project.clips.find((entry) => entry.id === clipId)
      const timelineMs = timelineMsFromClientX(e.clientX)
      drag = {
        pointerId: e.pointerId,
        mode: "pending-move",
        clipId,
        grabOffsetMs: clip ? timelineMs - clip.startMs : 0,
        seekMs: timelineMs,
        startClientX: e.clientX,
        startClientY: e.clientY,
      }
      onSelectClip(clipId)
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

  const finishPointer = (
    e: React.PointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDragging(false)
    if (!cancelled && isPendingEditDrag(drag)) {
      onSeek(drag.seekMs)
    } else if (
      drag.mode !== "seek" &&
      drag.mode !== "pan" &&
      !isPendingEditDrag(drag)
    ) {
      onEditCommit()
    }
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
        onPointerUp={(e) => finishPointer(e)}
        onPointerCancel={(e) => finishPointer(e, true)}
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
