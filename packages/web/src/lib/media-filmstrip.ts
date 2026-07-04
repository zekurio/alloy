import { useEffect, useState } from "react"
import type { RefObject } from "react"

/**
 * Renderer-side filmstrip sampling: evenly spaced frames decoded by seeking a
 * detached `<video>` element and drawing to canvas, so local captures
 * (`alloy-capture://`), uploaded clips (http stream), and picked upload Files
 * (object URLs) get identical treatment with no client-side demuxer.
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
  const [strip, setStrip] = useState(EMPTY_FILMSTRIP)
  useEffect(() => {
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
  stripRef: RefObject<HTMLElement | null>,
  aspect: number,
  maxCells: number,
  minCells = 1,
): number {
  const minimum = clampCellCount(minCells, maxCells)
  const [count, setCount] = useState(minimum)
  useEffect(() => {
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

const FRAME_EVENT_TIMEOUT_MS = 15000

async function extractFilmstrip(mediaUrl: string): Promise<MediaFilmstrip> {
  const video = document.createElement("video")
  video.preload = "auto"
  video.muted = true
  video.playsInline = true
  // Keeps decoded frames drawable to canvas when the media is served from
  // the API origin; harmless for same-origin and object URLs.
  video.crossOrigin = "anonymous"
  video.src = mediaUrl

  try {
    await videoEvent(video, "loadedmetadata")
    const durationSec = video.duration
    if (!Number.isFinite(durationSec) || !(durationSec > 0)) {
      return EMPTY_FILMSTRIP
    }

    const frames: string[] = []
    let aspect: number | null = null
    for (let i = 0; i < FILMSTRIP_FRAME_COUNT; i++) {
      // A failed seek (e.g. an undecodable region) just yields fewer cells;
      // the strip stretches the neighbors over it.
      const frame = await seekFrameObjectUrl(
        video,
        ((i + 0.5) / FILMSTRIP_FRAME_COUNT) * durationSec,
      )
      if (!frame) continue
      aspect ??= frame.aspect
      frames.push(frame.url)
    }
    return {
      frames,
      aspect: aspect ?? DEFAULT_FRAME_ASPECT,
      durationMs: Math.round(durationSec * 1000),
    }
  } finally {
    video.removeAttribute("src")
    try {
      video.load()
    } catch {
      // Some mobile browsers throw while tearing down blob-backed media.
    }
  }
}

async function seekFrameObjectUrl(
  video: HTMLVideoElement,
  timeSec: number,
): Promise<{ url: string; aspect: number } | null> {
  try {
    const seeked = videoEvent(video, "seeked")
    video.currentTime = timeSec
    await seeked
  } catch {
    return null
  }
  // An unsupported codec parses metadata but never decodes a frame; skip
  // instead of drawing black cells.
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
  const srcW = video.videoWidth
  const srcH = video.videoHeight
  if (!srcW || !srcH) return null

  const canvas = document.createElement("canvas")
  canvas.height = FRAME_HEIGHT
  canvas.width = Math.max(1, Math.round((srcW / srcH) * FRAME_HEIGHT))
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", FRAME_QUALITY)
  }).catch(() => null)
  // toBlob rejects/throws on tainted canvases (cross-origin media without
  // CORS headers) — treat as no frame rather than failing the whole strip.
  if (!blob) return null
  return {
    url: URL.createObjectURL(blob),
    aspect: canvas.width / canvas.height,
  }
}

function videoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "seeked",
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.removeEventListener(eventName, onEvent)
      video.removeEventListener("error", onError)
    }
    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(video.error?.message ?? "Video element error"))
    }
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${eventName}`))
    }, FRAME_EVENT_TIMEOUT_MS)
    video.addEventListener(eventName, onEvent, { once: true })
    video.addEventListener("error", onError, { once: true })
  })
}
