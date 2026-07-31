import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { KeyboardEvent, PointerEvent } from "react"

import { FilmstripCanvas } from "@/components/media/filmstrip-canvas"
import { formatMediaDurationMs, formatTrimMs } from "@/lib/media-time"

/**
 * Touch trimmer built like a mobile editor timeline: the playhead is pinned
 * to the centre and the media travels under it. Dragging the strip scrubs,
 * pinching zooms the time scale, and the kept range's handles resize the cut
 * — zoom is what buys frame-level precision, so no numeric nudge controls are
 * needed beside it.
 */

/** Hard cap on filmstrip cells (canvas draw-call guard). */
const MAX_FILMSTRIP_CELLS = 64
/** Rendered strip width, in viewport widths, so panning is a GPU transform. */
const CONTENT_SPAN = 2
/** Ceiling on the time scale: ~1px per 2.5ms, finer than a 60fps frame. */
const MAX_ZOOM_PX_PER_MS = 0.4
/** Smallest gap between two labelled ruler ticks. */
const MIN_TICK_GAP_PX = 72
const RULER_HEIGHT_PX = 20
const STRIP_HEIGHT_PX = 60
const RULER_STEPS_MS = [
  250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000,
  300_000, 600_000,
]

type Gesture =
  | { kind: "pan"; pointerId: number; startX: number; startMs: number }
  | {
      kind: "handle"
      pointerId: number
      edge: "start" | "end"
      startX: number
      startMs: number
    }
  | { kind: "pinch"; startDistance: number; startZoom: number }

export function TrimTimeline({
  frames,
  frameAspect,
  durationMs,
  startMs,
  endMs,
  subscribeCurrentMs,
  getCurrentMs,
  onScrub,
  onStartChange,
  onEndChange,
  canTrim = true,
  className,
}: {
  /** Frame image URLs sampled evenly across the source media. */
  frames: string[]
  /** Width/height ratio of the frames — cells size to match, never squish. */
  frameAspect: number
  durationMs: number
  startMs: number
  endMs: number
  /** Playhead store in source time; the strip follows it without re-rendering. */
  subscribeCurrentMs: (listener: () => void) => () => void
  getCurrentMs: () => number
  /** Moves the playhead (caller pauses and clamps). */
  onScrub: (sourceMs: number) => void
  /** Live trim-handle updates in absolute source time (caller clamps). */
  onStartChange: (sourceMs: number) => void
  onEndChange: (sourceMs: number) => void
  canTrim?: boolean
  className?: string
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const pointersRef = useRef(new Map<number, number>())
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(0)
  // Left edge of the rendered strip, in source time. The strip covers more
  // than the viewport so ordinary playback only shifts a transform; it is
  // re-anchored (and repainted) once the playhead nears its edge.
  const [anchorMs, setAnchorMs] = useState(0)
  const [gesturing, setGesturing] = useState(false)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const read = () => setWidth(viewport.getBoundingClientRect().width)
    read()
    const observer = new ResizeObserver(read)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const fitZoom = width > 0 && durationMs > 0 ? width / durationMs : 0
  const ready = fitZoom > 0 && zoom > 0
  const contentWidth = width * CONTENT_SPAN
  const contentMs = ready ? contentWidth / zoom : 0

  // The whole clip is the zoomed-out limit: adopt it on first measure, and
  // raise a scale that no longer fills the viewport (late duration, rotation).
  useEffect(() => {
    if (fitZoom <= 0) return
    setZoom((current) => (current < fitZoom ? fitZoom : current))
  }, [fitZoom])

  const applyOffset = useCallback(() => {
    const content = contentRef.current
    if (!content || !ready) return
    const offset = width / 2 - (getCurrentMs() - anchorMs) * zoom
    content.style.transform = `translateX(${offset}px)`
  }, [anchorMs, getCurrentMs, ready, width, zoom])

  const reanchor = useCallback(() => {
    if (!ready) return
    const currentMs = getCurrentMs()
    if (
      currentMs >= anchorMs + contentMs * 0.25 &&
      currentMs <= anchorMs + contentMs * 0.75
    ) {
      return
    }
    setAnchorMs(currentMs - contentMs / 2)
  }, [anchorMs, contentMs, getCurrentMs, ready])

  useLayoutEffect(applyOffset, [applyOffset])
  useEffect(reanchor, [reanchor])
  useEffect(() => {
    return subscribeCurrentMs(() => {
      applyOffset()
      reanchor()
    })
  }, [applyOffset, reanchor, subscribeCurrentMs])

  const clampZoom = useCallback(
    (next: number) => Math.min(MAX_ZOOM_PX_PER_MS, Math.max(fitZoom, next)),
    [fitZoom],
  )

  // Pointer devices get the same two gestures: a trackpad pinch (which the
  // platform reports as ctrl+wheel) zooms, horizontal wheel scrubs. Vertical
  // wheel is left alone so the page still scrolls over the timeline.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !ready) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        setZoom((current) => clampZoom(current * Math.exp(-event.deltaY / 240)))
        return
      }
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      onScrub(getCurrentMs() + event.deltaX / zoom)
    }
    viewport.addEventListener("wheel", onWheel, { passive: false })
    return () => viewport.removeEventListener("wheel", onWheel)
  }, [clampZoom, getCurrentMs, onScrub, ready, zoom])

  const startPan = (pointerId: number, clientX: number) => {
    gestureRef.current = {
      kind: "pan",
      pointerId,
      startX: clientX,
      startMs: getCurrentMs(),
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!ready || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, e.clientX)
    setGesturing(true)

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()]
      gestureRef.current = {
        kind: "pinch",
        startDistance: Math.max(1, Math.abs((first ?? 0) - (second ?? 0))),
        startZoom: zoom,
      }
      return
    }
    if (pointersRef.current.size > 1) return

    const handleEl = (e.target as Element).closest<HTMLElement>(
      "[data-trim-handle]",
    )
    if (handleEl && canTrim) {
      const edge = handleEl.dataset.trimHandle === "start" ? "start" : "end"
      gestureRef.current = {
        kind: "handle",
        pointerId: e.pointerId,
        edge,
        startX: e.clientX,
        startMs: edge === "start" ? startMs : endMs,
      }
      return
    }
    startPan(e.pointerId, e.clientX)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, e.clientX)
    const gesture = gestureRef.current
    if (!gesture) return

    if (gesture.kind === "pinch") {
      const [first, second] = [...pointersRef.current.values()]
      if (first === undefined || second === undefined) return
      const distance = Math.max(1, Math.abs(first - second))
      setZoom(clampZoom(gesture.startZoom * (distance / gesture.startDistance)))
      return
    }

    if (gesture.pointerId !== e.pointerId) return
    const deltaMs = (e.clientX - gesture.startX) / zoom
    // Dragging right pulls earlier material under the playhead, like sliding
    // a filmstrip past a fixed gate.
    if (gesture.kind === "pan") onScrub(gesture.startMs - deltaMs)
    else if (gesture.edge === "start") onStartChange(gesture.startMs + deltaMs)
    else onEndChange(gesture.startMs + deltaMs)
  }

  const finishPointer = (e: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const gesture = gestureRef.current
    if (gesture?.kind === "pinch") {
      // Lifting one finger of a pinch hands the drag back to the other.
      const [remaining] = [...pointersRef.current.entries()]
      if (remaining) startPan(remaining[0], remaining[1])
      else gestureRef.current = null
    } else if (gesture && gesture.pointerId === e.pointerId) {
      gestureRef.current = null
    }
    if (pointersRef.current.size === 0) setGesturing(false)
  }

  const handleKeyDown =
    (edge: "start" | "end") => (e: KeyboardEvent<HTMLDivElement>) => {
      if (!ready || !canTrim) return
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

  // Only the part of the strip that has media is painted; the rest of the
  // travel is empty track, so the clip's ends read as ends.
  const paintStartMs = Math.max(0, anchorMs)
  const paintEndMs = Math.min(durationMs, anchorMs + contentMs)
  const paintWidth = ready ? Math.max(0, (paintEndMs - paintStartMs) * zoom) : 0
  const x = (ms: number) => (ms - anchorMs) * zoom

  return (
    <div className={cn("relative", className)}>
      <div
        ref={viewportRef}
        className={cn(
          "relative touch-none overflow-hidden select-none",
          ready && (gesturing ? "cursor-grabbing" : "cursor-grab"),
        )}
        style={{ height: RULER_HEIGHT_PX + STRIP_HEIGHT_PX }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        {/* Sunken track under the strip: the run with no media reads as
            empty runway rather than as part of the filmstrip. */}
        <div
          aria-hidden
          className="bg-surface-sunken absolute inset-x-0 bottom-0"
          style={{ height: STRIP_HEIGHT_PX }}
        />

        <div
          ref={contentRef}
          className="absolute inset-y-0 left-0 will-change-transform"
          style={{ width: contentWidth }}
        >
          {ready ? (
            <RulerTicks
              anchorMs={anchorMs}
              contentMs={contentMs}
              durationMs={durationMs}
              zoom={zoom}
            />
          ) : null}

          <div
            className="absolute inset-x-0 bottom-0"
            style={{ height: STRIP_HEIGHT_PX }}
          >
            {paintWidth > 0 ? (
              <div
                className="bg-surface absolute inset-y-0 overflow-hidden"
                style={{ left: x(paintStartMs), width: paintWidth }}
              >
                <FilmstripCanvas
                  frames={frames}
                  cellCount={Math.min(
                    MAX_FILMSTRIP_CELLS,
                    Math.max(
                      1,
                      Math.round(paintWidth / (STRIP_HEIGHT_PX * frameAspect)),
                    ),
                  )}
                  durationMs={durationMs}
                  startMs={paintStartMs}
                  endMs={paintEndMs}
                />
                {/* Cut-away material stays visible but dimmed, so the handles
                    can always be dragged back out to recover it. */}
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-black/65"
                  style={{
                    width: Math.max(0, (startMs - paintStartMs) * zoom),
                  }}
                />
                <div
                  aria-hidden
                  className="absolute inset-y-0 right-0 bg-black/65"
                  style={{ width: Math.max(0, (paintEndMs - endMs) * zoom) }}
                />
              </div>
            ) : null}

            {ready ? (
              <div
                className="border-accent absolute inset-y-0 rounded-md border-2"
                style={{ left: x(startMs), width: (endMs - startMs) * zoom }}
              >
                <TrimHandle
                  edge="start"
                  startMs={startMs}
                  endMs={endMs}
                  durationMs={durationMs}
                  canTrim={canTrim}
                  onKeyDown={handleKeyDown("start")}
                />
                <TrimHandle
                  edge="end"
                  startMs={startMs}
                  endMs={endMs}
                  durationMs={durationMs}
                  canTrim={canTrim}
                  onKeyDown={handleKeyDown("end")}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]"
        >
          <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-white" />
        </div>
      </div>
    </div>
  )
}

/**
 * Time ruler over the strip: labelled ticks at a step wide enough to read,
 * halved by a minor dot, both in content (source-time) coordinates.
 */
function RulerTicks({
  anchorMs,
  contentMs,
  durationMs,
  zoom,
}: {
  anchorMs: number
  contentMs: number
  durationMs: number
  zoom: number
}) {
  const stepMs =
    RULER_STEPS_MS.find((step) => step * zoom >= MIN_TICK_GAP_PX) ??
    RULER_STEPS_MS[RULER_STEPS_MS.length - 1]
  const halfStepMs = stepMs / 2
  const firstIndex = Math.ceil(Math.max(0, anchorMs) / halfStepMs)
  const lastIndex = Math.floor(
    Math.min(durationMs, anchorMs + contentMs) / halfStepMs,
  )

  const ticks = []
  for (let index = firstIndex; index <= lastIndex; index++) {
    const ms = index * halfStepMs
    ticks.push(
      <div
        key={index}
        className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
        style={{ left: (ms - anchorMs) * zoom, height: RULER_HEIGHT_PX }}
      >
        {index % 2 === 0 ? (
          <span className="text-foreground-faint text-[10px] leading-5 tabular-nums">
            {/* Sub-second steps need the tenths, or neighbouring ticks read
                as the same second. */}
            {stepMs < 1000 ? formatTrimMs(ms) : formatMediaDurationMs(ms)}
          </span>
        ) : (
          <span className="bg-foreground-faint/50 mt-2 size-1 rounded-full" />
        )}
      </div>,
    )
  }
  return <div className="absolute inset-x-0 top-0">{ticks}</div>
}

/** Grab bar at one end of the kept range; wide enough for a fingertip. */
function TrimHandle({
  edge,
  startMs,
  endMs,
  durationMs,
  canTrim,
  onKeyDown,
}: {
  edge: "start" | "end"
  startMs: number
  endMs: number
  durationMs: number
  canTrim: boolean
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  const valueMs = edge === "start" ? startMs : endMs
  return (
    <div
      data-trim-handle={edge}
      role="slider"
      aria-label={edge === "start" ? t("Trim start") : t("Trim end")}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(valueMs / 1000)}
      aria-valuetext={formatTrimMs(valueMs)}
      aria-disabled={!canTrim}
      tabIndex={canTrim ? 0 : -1}
      onKeyDown={onKeyDown}
      className={cn(
        "bg-accent absolute inset-y-0 z-10 flex w-6 cursor-ew-resize items-center justify-center",
        edge === "start" ? "left-0 rounded-l-sm" : "right-0 rounded-r-sm",
        // Widen the hit area beyond the visible grip for touch.
        "after:absolute after:inset-y-0 after:-inset-x-2",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <span className="bg-accent-foreground/80 h-8 w-1 rounded-full" />
    </div>
  )
}
