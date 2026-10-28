import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import { ShrinkIcon } from "lucide-react"
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { KeyboardEvent, PointerEvent } from "react"

import { useElementSize } from "@/components/media/use-element-size"
import {
  WaveformCanvas,
  WaveformStatus,
} from "@/components/media/waveform-canvas"
import type { FilmstripFrame } from "@/lib/media-filmstrip"
import { formatTrimMs } from "@/lib/media-time"
import type { MediaWaveformState } from "@/lib/media-waveform"

import { TrimHandle, trimNudgeMs } from "./trim-handle"

/** Grab bars sit outside the kept range; the track leaves room for both. */
const HANDLE_WIDTH_PX = 16
const FRAME_LANE_PX = 48
const WAVE_LANE_PX = 20
/** Width of one filmstrip tile: narrow crops, like a phone's photo trimmer. */
const TILE_WIDTH_PX = 30
/** Ceiling on the time scale: ~1px per 2.5ms, finer than a 60fps frame. */
const MAX_ZOOM_PX_PER_MS = 0.4
/** A drag this close to a zoomed track's edge scrolls the view. */
const EDGE_SCROLL_ZONE_PX = 32
/** View travel per frame at the very edge of the scroll zone. */
const EDGE_SCROLL_MAX_PX = 10
/** Fraction of the view kept behind the playhead when the view follows it. */
const FOLLOW_LEAD = 0.1
/** Travel before a finger on the strip starts scrubbing. */
const SCRUB_SLOP_PX = 4

type View = {
  /** Zoom relative to the whole clip fitting the track; 1 is fully out. */
  scale: number
  /** Source time at the track's left edge. */
  startMs: number
}

type Gesture =
  | {
      kind: "scrub"
      pointerId: number
      clientX: number
      startX: number
      /**
       * Not yet past the slop. A pinch starts with one finger, so the strip
       * waits for movement, or a lift (a tap), before it seeks and pauses.
       */
      pending: boolean
    }
  | {
      kind: "handle"
      pointerId: number
      edge: "start" | "end"
      /** Finger distance from the cut point, kept for the whole drag. */
      grabOffsetPx: number
      clientX: number
    }
  | {
      kind: "pinch"
      startDistance: number
      startScale: number
      /** Source time under the pinch midpoint when it began. */
      anchorMs: number
    }

/**
 * Touch trimmer in the shape phone photo editors use: the whole clip fits the
 * width as a filmstrip over its waveform, the kept range is framed by two grab
 * bars outside it, and the cut-away ends are dimmed. Dragging a bar moves that
 * cut while the (paused) player shows its frame; dragging anywhere else
 * scrubs. Pinching zooms the time scale for frame-level cuts, and a zoomed
 * view scrolls when a drag reaches its edge.
 */
export function TrimTimeline({
  waveform,
  frames,
  framesUnavailable = false,
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
  /** Audio peak data for the source media. */
  waveform: MediaWaveformState
  /** Video frames across the source, in time order; may still be filling. */
  frames: FilmstripFrame[]
  /** No frames are coming (no WebCodecs); the waveform takes the strip. */
  framesUnavailable?: boolean
  durationMs: number
  startMs: number
  endMs: number
  /** Playhead store in source time; the playhead follows it without re-rendering. */
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
  const playheadRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const { width } = useElementSize(viewportRef)
  const [view, setView] = useState<View>({ scale: 1, startMs: 0 })
  const [activeEdge, setActiveEdge] = useState<"start" | "end" | null>(null)
  const [gesturing, setGesturing] = useState(false)

  const trackWidth = Math.max(0, width - HANDLE_WIDTH_PX * 2)
  const ready = trackWidth > 0 && durationMs > 0
  const fitPxPerMs = ready ? trackWidth / durationMs : 0
  const maxScale = ready ? Math.max(1, MAX_ZOOM_PX_PER_MS / fitPxPerMs) : 1
  const pxPerMs = fitPxPerMs * view.scale
  const spanMs = ready ? durationMs / view.scale : 0
  const zoomed = view.scale > 1.001

  const clampView = (next: View): View => {
    const scale = Math.min(maxScale, Math.max(1, next.scale))
    const span = durationMs / scale
    return {
      scale,
      startMs: Math.min(Math.max(0, next.startMs), durationMs - span),
    }
  }

  /** Viewport x of a source time; the track starts after the start bar. */
  const xOf = (ms: number) => HANDLE_WIDTH_PX + (ms - view.startMs) * pxPerMs
  const msAt = (clientX: number, at: View = view) => {
    const left = viewportRef.current?.getBoundingClientRect().left ?? 0
    const scale = fitPxPerMs * at.scale
    return at.startMs + (clientX - left - HANDLE_WIDTH_PX) / scale
  }

  // The playhead moves every animation frame while playing; it is positioned
  // straight from the store so the strip doesn't re-render at 60fps. Only a
  // moving playhead (playback, nudges) drags a zoomed view along; a re-render
  // after the user pinched elsewhere leaves their view alone.
  const placePlayhead = useEffectEvent((follow: boolean) => {
    const playhead = playheadRef.current
    if (!playhead || !ready) return
    const currentMs = getCurrentMs()
    const x = xOf(currentMs)
    playhead.style.transform = `translateX(${x}px)`
    playhead.style.opacity =
      x < HANDLE_WIDTH_PX - 1 || x > HANDLE_WIDTH_PX + trackWidth + 1
        ? "0"
        : "1"
    // A zoomed view pages along with playback instead of losing the playhead.
    if (
      follow &&
      zoomed &&
      gestureRef.current === null &&
      (currentMs < view.startMs || currentMs > view.startMs + spanMs)
    ) {
      setView(clampView({ ...view, startMs: currentMs - spanMs * FOLLOW_LEAD }))
    }
  })
  useLayoutEffect(() => placePlayhead(false))
  useEffect(
    () => subscribeCurrentMs(() => placePlayhead(true)),
    [subscribeCurrentMs],
  )

  const applyDrag = (gesture: Gesture, at: View) => {
    if (gesture.kind === "scrub") {
      onScrub(Math.min(durationMs, Math.max(0, msAt(gesture.clientX, at))))
      return
    }
    if (gesture.kind !== "handle") return
    const ms = msAt(gesture.clientX - gesture.grabOffsetPx, at)
    if (gesture.edge === "start") onStartChange(ms)
    else onEndChange(ms)
  }

  // While a drag rests in a zoomed track's edge zone, keep scrolling the view
  // and re-apply the drag, so a cut can be carried past what's on screen.
  const edgeScroll = useEffectEvent(() => {
    const gesture = gestureRef.current
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!gesture || gesture.kind === "pinch" || !rect || !zoomed) return
    if (gesture.kind === "scrub" && gesture.pending) return
    const trackLeft = rect.left + HANDLE_WIDTH_PX
    const trackRight = trackLeft + trackWidth
    const x = gesture.clientX
    const depth =
      x < trackLeft + EDGE_SCROLL_ZONE_PX
        ? -(trackLeft + EDGE_SCROLL_ZONE_PX - x) / EDGE_SCROLL_ZONE_PX
        : x > trackRight - EDGE_SCROLL_ZONE_PX
          ? (x - (trackRight - EDGE_SCROLL_ZONE_PX)) / EDGE_SCROLL_ZONE_PX
          : 0
    if (depth === 0) return
    const shift =
      (Math.max(-1, Math.min(1, depth)) * EDGE_SCROLL_MAX_PX) / pxPerMs
    const next = clampView({ ...view, startMs: view.startMs + shift })
    if (next.startMs === view.startMs) return
    setView(next)
    applyDrag(gesture, next)
  })
  useEffect(() => {
    if (!gesturing || !zoomed) return
    let frame = requestAnimationFrame(function tick() {
      edgeScroll()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [gesturing, zoomed])

  // A trackpad pinch (reported as ctrl+wheel) zooms around the pointer;
  // horizontal wheel pans a zoomed view. Vertical wheel still scrolls the page.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (!ready) return
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const anchorMs = msAt(event.clientX)
      const scale = view.scale * Math.exp(-event.deltaY / 240)
      const left = viewportRef.current?.getBoundingClientRect().left ?? 0
      const offsetPx = event.clientX - left - HANDLE_WIDTH_PX
      setView(
        clampView({
          scale,
          startMs: anchorMs - offsetPx / (fitPxPerMs * scale),
        }),
      )
      return
    }
    if (!zoomed || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    event.preventDefault()
    setView(
      clampView({ ...view, startMs: view.startMs + event.deltaX / pxPerMs }),
    )
  })
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleWheel = (event: WheelEvent) => onWheel(event)
    viewport.addEventListener("wheel", handleWheel, { passive: false })
    return () => viewport.removeEventListener("wheel", handleWheel)
  }, [])

  const startPinch = () => {
    const [first, second] = [...pointersRef.current.values()]
    if (!first || !second) return
    const midX = (first.x + second.x) / 2
    gestureRef.current = {
      kind: "pinch",
      startDistance: Math.max(
        1,
        Math.hypot(first.x - second.x, first.y - second.y),
      ),
      startScale: view.scale,
      anchorMs: msAt(midX),
    }
    setActiveEdge(null)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!ready || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setGesturing(true)

    if (pointersRef.current.size === 2) {
      startPinch()
      return
    }
    if (pointersRef.current.size > 2) return

    const handleEl =
      e.target instanceof Element
        ? e.target.closest<HTMLElement>("[data-trim-handle]")
        : null
    if (handleEl && canTrim) {
      const edge = handleEl.dataset.trimHandle === "start" ? "start" : "end"
      gestureRef.current = {
        kind: "handle",
        pointerId: e.pointerId,
        edge,
        grabOffsetPx:
          e.clientX -
          ((viewportRef.current?.getBoundingClientRect().left ?? 0) +
            xOf(edge === "start" ? startMs : endMs)),
        clientX: e.clientX,
      }
      setActiveEdge(edge)
      return
    }
    gestureRef.current = {
      kind: "scrub",
      pointerId: e.pointerId,
      clientX: e.clientX,
      startX: e.clientX,
      pending: true,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const gesture = gestureRef.current
    if (!gesture) return

    if (gesture.kind === "pinch") {
      const [first, second] = [...pointersRef.current.values()]
      if (!first || !second) return
      const distance = Math.max(
        1,
        Math.hypot(first.x - second.x, first.y - second.y),
      )
      const scale = Math.min(
        maxScale,
        Math.max(1, gesture.startScale * (distance / gesture.startDistance)),
      )
      // Keep the moment under the fingers there, so pinching also pans.
      const left = viewportRef.current?.getBoundingClientRect().left ?? 0
      const midX = (first.x + second.x) / 2 - left - HANDLE_WIDTH_PX
      setView(
        clampView({
          scale,
          startMs: gesture.anchorMs - midX / (fitPxPerMs * scale),
        }),
      )
      return
    }

    if (gesture.pointerId !== e.pointerId) return
    gesture.clientX = e.clientX
    if (gesture.kind === "scrub" && gesture.pending) {
      if (Math.abs(e.clientX - gesture.startX) < SCRUB_SLOP_PX) return
      gesture.pending = false
    }
    applyDrag(gesture, view)
  }

  const finishPointer = (e: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const gesture = gestureRef.current
    if (gesture?.kind === "pinch") {
      // The finger left over from a pinch does nothing until it lifts too,
      // rather than scrubbing the playhead to wherever it rests.
      gestureRef.current = null
    } else if (gesture && gesture.pointerId === e.pointerId) {
      // A tap on the strip seeks there.
      if (
        gesture.kind === "scrub" &&
        gesture.pending &&
        e.type === "pointerup"
      ) {
        applyDrag(gesture, view)
      }
      gestureRef.current = null
      setActiveEdge(null)
    }
    if (pointersRef.current.size === 0) {
      gestureRef.current = null
      setGesturing(false)
      setActiveEdge(null)
    }
  }

  const handleKeyDown =
    (edge: "start" | "end") => (e: KeyboardEvent<HTMLDivElement>) => {
      if (!ready || !canTrim) return
      const deltaMs = trimNudgeMs(e)
      if (deltaMs === null) return
      e.preventDefault()
      e.stopPropagation()
      if (edge === "start") onStartChange(startMs + deltaMs)
      else onEndChange(endMs + deltaMs)
    }

  const viewEndMs = view.startMs + spanMs
  const startX = xOf(startMs)
  const endX = xOf(endMs)

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2 px-1 font-mono text-xs tabular-nums">
        <span
          className={cn(
            "transition-colors",
            activeEdge === "start"
              ? "text-foreground"
              : "text-foreground-muted",
          )}
        >
          {formatTrimMs(startMs)}
        </span>
        <span className="text-foreground mx-auto font-sans text-sm font-semibold">
          {formatTrimMs(endMs - startMs)}
        </span>
        {zoomed ? (
          <button
            type="button"
            className="text-foreground-muted hover:text-foreground border-border bg-surface-raised inline-flex h-6 items-center gap-1 rounded-full border px-2 font-sans text-[11px] font-semibold"
            aria-label={t("Show the whole clip")}
            onClick={() => setView({ scale: 1, startMs: 0 })}
          >
            <ShrinkIcon className="size-3" />
            {`${view.scale.toFixed(1)}×`}
          </button>
        ) : null}
        <span
          className={cn(
            "transition-colors",
            activeEdge === "end" ? "text-foreground" : "text-foreground-muted",
          )}
        >
          {formatTrimMs(endMs)}
        </span>
      </div>

      <div
        ref={viewportRef}
        className="relative touch-none overflow-hidden select-none"
        style={{ height: FRAME_LANE_PX + WAVE_LANE_PX }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        {/* Media lanes, clipped to the track between the two bar gutters. */}
        <div
          className="bg-surface-sunken absolute inset-y-0 overflow-hidden rounded-xs"
          style={{ left: HANDLE_WIDTH_PX, width: trackWidth }}
        >
          {ready ? (
            <FilmstripTiles
              frames={frames}
              viewStartMs={view.startMs}
              viewEndMs={viewEndMs}
              pxPerMs={pxPerMs}
            />
          ) : null}
          <div
            className="bg-surface absolute inset-x-0 bottom-0"
            style={{
              height:
                framesUnavailable && frames.length === 0
                  ? FRAME_LANE_PX + WAVE_LANE_PX
                  : WAVE_LANE_PX,
            }}
          >
            {ready ? (
              <WaveformCanvas
                peaks={waveform.peaks}
                durationMs={durationMs}
                status={waveform.status}
                startMs={view.startMs}
                endMs={viewEndMs}
              />
            ) : null}
            {waveform.status !== "ready" ? (
              <WaveformStatus status={waveform.status} />
            ) : null}
          </div>
          {/* Cut-away material stays visible but dimmed, so a bar can always
              be dragged back out to recover it. */}
          {ready ? (
            <>
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 bg-black/55"
                style={{ width: Math.max(0, startX - HANDLE_WIDTH_PX) }}
              />
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 bg-black/55"
                style={{
                  width: Math.max(0, HANDLE_WIDTH_PX + trackWidth - endX),
                }}
              />
              {/* The kept range's frame, joining the two bars. */}
              <div
                aria-hidden
                className="bg-accent absolute top-0 h-[3px]"
                style={{
                  left: startX - HANDLE_WIDTH_PX,
                  width: endX - startX,
                }}
              />
              <div
                aria-hidden
                className="bg-accent absolute bottom-0 h-[3px]"
                style={{
                  left: startX - HANDLE_WIDTH_PX,
                  width: endX - startX,
                }}
              />
            </>
          ) : null}
        </div>

        {ready ? (
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{
              left: startX - HANDLE_WIDTH_PX,
              width: endX - startX + HANDLE_WIDTH_PX * 2,
            }}
          >
            <TrimHandle
              edge="start"
              valueMs={startMs}
              durationMs={durationMs}
              variant="timeline"
              active={activeEdge === "start"}
              disabled={!canTrim}
              onKeyDown={handleKeyDown("start")}
            />
            <TrimHandle
              edge="end"
              valueMs={endMs}
              durationMs={durationMs}
              variant="timeline"
              active={activeEdge === "end"}
              disabled={!canTrim}
              onKeyDown={handleKeyDown("end")}
            />
          </div>
        ) : null}

        <div
          ref={playheadRef}
          aria-hidden
          className="pointer-events-none absolute -top-0.5 -bottom-0.5 left-0 z-20 w-0"
        >
          <div className="absolute inset-y-0 -left-[1.5px] w-[3px] rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_0_6px_rgba(0,0,0,0.5)]" />
        </div>
      </div>
    </div>
  )
}

/**
 * Narrow frame crops laid along the visible time window. Tiles are anchored
 * to source time so they travel with a pan, and each shows the loaded frame
 * nearest its middle — a zoomed strip repeats frames rather than going blank.
 */
function FilmstripTiles({
  frames,
  viewStartMs,
  viewEndMs,
  pxPerMs,
}: {
  frames: FilmstripFrame[]
  viewStartMs: number
  viewEndMs: number
  pxPerMs: number
}) {
  if (frames.length === 0 || pxPerMs <= 0) return null
  const tileMs = TILE_WIDTH_PX / pxPerMs
  const first = Math.floor(viewStartMs / tileMs)
  const last = Math.ceil(viewEndMs / tileMs)
  const tiles = []
  for (let index = first; index < last; index++) {
    const frame = nearestFrame(frames, (index + 0.5) * tileMs)
    if (!frame) break
    tiles.push(
      <img
        key={index}
        src={frame.url}
        alt=""
        draggable={false}
        className="absolute top-0 object-cover"
        style={{
          left: (index * tileMs - viewStartMs) * pxPerMs,
          width: TILE_WIDTH_PX + 0.5,
          height: FRAME_LANE_PX,
        }}
      />,
    )
  }
  return <div aria-hidden>{tiles}</div>
}

function nearestFrame(
  frames: FilmstripFrame[],
  ms: number,
): FilmstripFrame | null {
  let best: FilmstripFrame | null = null
  for (const frame of frames) {
    if (!best || Math.abs(frame.timeMs - ms) < Math.abs(best.timeMs - ms)) {
      best = frame
    }
  }
  return best
}
