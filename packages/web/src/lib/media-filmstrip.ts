import { ALL_FORMATS, CanvasSink, Input } from "mediabunny"
import * as React from "react"

import { createCaptureSource } from "@/lib/capture-source"

/**
 * Renderer-side filmstrip sampling: evenly spaced frames decoded with
 * mediabunny over the same byte-range transport the preview engine uses, so
 * local captures (`alloy-capture://`) and uploaded clips (http stream) get
 * identical treatment.
 */

export const FILMSTRIP_FRAME_COUNT = 16
/** Decode height of a strip frame; cells crop the rest with object-cover. */
const FRAME_HEIGHT = 96
const FRAME_QUALITY = 0.7
/** Aspect assumed until the first frame decodes (captures are 16:9). */
const DEFAULT_FRAME_ASPECT = 16 / 9

export interface MediaFilmstrip {
  /** Object URLs of evenly spaced frames; empty while loading or on failure. */
  frames: string[]
  /** Width/height ratio of the decoded frames (display-corrected). */
  aspect: number
  /**
   * Duration measured from the media itself. More trustworthy than recorded
   * metadata, which can overshoot (replay saves report the requested buffer
   * window even when the buffer held less footage).
   */
  durationMs: number | null
}

const EMPTY_FILMSTRIP: MediaFilmstrip = {
  frames: [],
  aspect: DEFAULT_FRAME_ASPECT,
  durationMs: null,
}

/**
 * Frames are extracted once per media URL and kept for the session — the
 * same lifetime the desktop's on-disk frame cache used to provide. Failures
 * don't cache, so a remount retries after transient (network) errors.
 */
const filmstripCache = new Map<string, Promise<MediaFilmstrip>>()

export function mediaFilmstrip(mediaUrl: string): Promise<MediaFilmstrip> {
  let pending = filmstripCache.get(mediaUrl)
  if (!pending) {
    pending = extractFilmstrip(mediaUrl).catch(() => {
      filmstripCache.delete(mediaUrl)
      return EMPTY_FILMSTRIP
    })
    filmstripCache.set(mediaUrl, pending)
  }
  return pending
}

export function useMediaFilmstrip(mediaUrl: string | null): MediaFilmstrip {
  const [strip, setStrip] = React.useState(EMPTY_FILMSTRIP)
  React.useEffect(() => {
    setStrip(EMPTY_FILMSTRIP)
    if (!mediaUrl) return
    let cancelled = false
    void mediaFilmstrip(mediaUrl).then((result) => {
      if (!cancelled) setStrip(result)
    })
    return () => {
      cancelled = true
    }
  }, [mediaUrl])
  return strip
}

/**
 * Cell count that prefers frame-aspect cells for the observed strip, with a
 * floor for timelines that need enough cells to keep time buckets aligned.
 */
export function useFilmstripCellCount(
  stripRef: React.RefObject<HTMLElement | null>,
  aspect: number,
  maxCells: number,
  minCells = 1,
): number {
  const minimum = clampCellCount(minCells, maxCells)
  const [count, setCount] = React.useState(minimum)
  React.useEffect(() => {
    setCount(minimum)
    const el = stripRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!(width > 0) || !(height > 0)) return
      setCount(
        Math.min(
          maxCells,
          Math.max(minimum, Math.round(width / (height * aspect))),
        ),
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [stripRef, aspect, maxCells, minimum])
  return count
}

export function filmstripCellsForRange({
  frames,
  cellCount,
  durationMs,
  startMs = 0,
  endMs = durationMs,
}: {
  frames: string[]
  cellCount: number
  durationMs: number
  startMs?: number
  endMs?: number
}): string[] {
  const count = Math.max(0, Math.round(cellCount))
  if (frames.length === 0 || count === 0 || !(durationMs > 0)) return []
  const start = clampMs(startMs, durationMs)
  const end = Math.max(start, clampMs(endMs, durationMs))
  const rangeMs = end - start
  if (!(rangeMs > 0)) return []

  const cells: string[] = []
  for (let i = 0; i < count; i++) {
    const sourceMs = start + ((i + 0.5) / count) * rangeMs
    cells.push(frames[filmstripFrameIndex(sourceMs, durationMs, frames.length)])
  }
  return cells
}

function filmstripFrameIndex(
  sourceMs: number,
  durationMs: number,
  frameCount: number,
): number {
  const pct = Math.min(1, Math.max(0, sourceMs / durationMs))
  return Math.min(frameCount - 1, Math.floor(pct * frameCount))
}

function clampCellCount(count: number, maxCells: number): number {
  if (!Number.isFinite(count)) return 1
  return Math.min(maxCells, Math.max(1, Math.round(count)))
}

function clampMs(ms: number, durationMs: number): number {
  if (!Number.isFinite(ms)) return 0
  return Math.min(durationMs, Math.max(0, ms))
}

async function extractFilmstrip(mediaUrl: string): Promise<MediaFilmstrip> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: createCaptureSource(mediaUrl),
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) return EMPTY_FILMSTRIP
    const durationSec = await input.computeDuration()
    if (!(durationSec > 0)) return EMPTY_FILMSTRIP

    const sink = new CanvasSink(track, { height: FRAME_HEIGHT })
    const timestamps = Array.from(
      { length: FILMSTRIP_FRAME_COUNT },
      (_, i) => ((i + 0.5) / FILMSTRIP_FRAME_COUNT) * durationSec,
    )
    const frames: string[] = []
    let aspect: number | null = null
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      // A gap (e.g. an undecodable region) just yields fewer cells; the
      // strip stretches the neighbors over it.
      if (wrapped) {
        aspect ??= wrapped.canvas.width / wrapped.canvas.height
        frames.push(await canvasObjectUrl(wrapped.canvas))
      }
    }
    return {
      frames,
      aspect: aspect ?? DEFAULT_FRAME_ASPECT,
      durationMs: Math.round(durationSec * 1000),
    }
  } finally {
    input.dispose()
  }
}

async function canvasObjectUrl(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<string> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({
          type: "image/jpeg",
          quality: FRAME_QUALITY,
        })
      : await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) => {
              if (result) resolve(result)
              else reject(new Error("canvas.toBlob returned null"))
            },
            "image/jpeg",
            FRAME_QUALITY,
          )
        })
  return URL.createObjectURL(blob)
}
