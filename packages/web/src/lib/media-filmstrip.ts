import {
  CLIP_SCRUBBER_COLUMNS,
  CLIP_SCRUBBER_FRAME_COUNT,
  CLIP_SCRUBBER_FRAME_HEIGHT,
  desktopBridgeSupports,
} from "@alloy/contracts"
import type { AlloyDesktop, RecordingLibraryItem } from "@alloy/contracts"
import { useEffect, useState } from "react"
import type { RefObject } from "react"

import { scheduleBackgroundMediaWork } from "./background-media-work"
import {
  canvasJpegBlob,
  teardownVideoElement,
  videoEvent,
} from "./video-events"

/**
 * Renderer-side filmstrip sampling with two sources: evenly spaced frames
 * decoded by seeking a detached `<video>` element (local captures and picked
 * upload Files), or cells sliced from a server-rendered sprite sheet
 * (uploaded clips). Neither needs a client-side demuxer.
 */

export const FILMSTRIP_FRAME_COUNT = CLIP_SCRUBBER_FRAME_COUNT
/** Decode height of a strip frame; cells crop the rest with object-cover. */
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
 * Frames are extracted once per media URL and cached with a small LRU-ish
 * cap; evicted strips revoke their frame object URLs so long browsing
 * sessions don't pin every visited clip's frames in memory. Failures don't
 * cache, so a remount retries after transient (network) errors.
 */
const filmstripCache = new Map<string, Promise<MediaFilmstrip>>()
const MAX_FILMSTRIP_CACHE_ENTRIES = 24

function evictStaleFilmstrips(): void {
  while (filmstripCache.size > MAX_FILMSTRIP_CACHE_ENTRIES) {
    const oldest = filmstripCache.keys().next().value
    if (oldest === undefined) return
    const pending = filmstripCache.get(oldest)
    filmstripCache.delete(oldest)
    void pending?.then((strip) => {
      for (const frame of strip.frames) URL.revokeObjectURL(frame)
    })
  }
}

export function mediaFilmstrip(mediaUrl: string): Promise<MediaFilmstrip> {
  return cachedFilmstrip(mediaUrl, () =>
    scheduleBackgroundMediaWork(`filmstrip:${mediaUrl}`, (signal) =>
      extractFilmstrip(mediaUrl, signal),
    ),
  )
}

export function spriteSheetFilmstrip(
  sheetUrl: string,
): Promise<MediaFilmstrip> {
  return cachedFilmstrip(sheetUrl, () => extractSpriteFilmstrip(sheetUrl))
}

function cachedFilmstrip(
  key: string,
  extract: () => Promise<MediaFilmstrip>,
): Promise<MediaFilmstrip> {
  let pending = filmstripCache.get(key)
  if (!pending) {
    pending = extract().catch(() => {
      filmstripCache.delete(key)
      return EMPTY_FILMSTRIP
    })
    filmstripCache.set(key, pending)
    evictStaleFilmstrips()
  }
  return pending
}

export function useMediaFilmstrip(mediaUrl: string | null): MediaFilmstrip {
  return useFilmstrip(mediaUrl, mediaFilmstrip)
}

export function desktopMediaFilmstrip(
  desktop: AlloyDesktop,
  item: RecordingLibraryItem,
): Promise<MediaFilmstrip> {
  if (
    !desktopBridgeSupports(
      desktop.bridge.version,
      "recording.getLibraryCaptureScrubber",
    )
  ) {
    return mediaFilmstrip(item.mediaUrl)
  }
  const key = `desktop-filmstrip:${item.id}:${item.modifiedAt}:${item.sizeBytes}`
  return cachedFilmstrip(key, () =>
    scheduleBackgroundMediaWork(key, (signal) =>
      loadDesktopFilmstrip(desktop, item, signal),
    ),
  )
}

export function useDesktopMediaFilmstrip(
  desktop: AlloyDesktop,
  item: RecordingLibraryItem,
): MediaFilmstrip {
  const [strip, setStrip] = useState(EMPTY_FILMSTRIP)
  useEffect(() => {
    let cancelled = false
    setStrip(EMPTY_FILMSTRIP)
    void desktopMediaFilmstrip(desktop, item).then((result) => {
      if (!cancelled) setStrip(result)
    })
    return () => {
      cancelled = true
    }
  }, [desktop, item.id, item.mediaUrl, item.modifiedAt, item.sizeBytes])
  return strip
}

export function useSpriteSheetFilmstrip(
  sheetUrl: string | null,
): MediaFilmstrip {
  return useFilmstrip(sheetUrl, spriteSheetFilmstrip)
}

function useFilmstrip(
  url: string | null,
  load: (url: string) => Promise<MediaFilmstrip>,
): MediaFilmstrip {
  const [strip, setStrip] = useState(EMPTY_FILMSTRIP)
  useEffect(() => {
    setStrip(EMPTY_FILMSTRIP)
    if (!url) return
    let cancelled = false
    void load(url).then((result) => {
      if (!cancelled) setStrip(result)
    })
    return () => {
      cancelled = true
    }
  }, [url, load])
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

async function loadDesktopFilmstrip(
  desktop: AlloyDesktop,
  item: RecordingLibraryItem,
  signal: AbortSignal,
): Promise<MediaFilmstrip> {
  const cached = await desktop.recording.getLibraryCaptureScrubber(item.id)
  if (cached) {
    try {
      return await filmstripFromSpriteBlob(
        new Blob([cached.slice().buffer], { type: "image/jpeg" }),
        item.durationMs,
      )
    } catch {
      // A partial/corrupt cache entry is replaced by a fresh sprite below.
    }
  }

  const generated = await generateFilmstripSprite(item.mediaUrl, signal)
  await desktop.recording.saveLibraryCaptureScrubber(
    item.id,
    new Uint8Array(await generated.blob.arrayBuffer()),
  )
  return filmstripFromSpriteBlob(generated.blob, generated.durationMs)
}

async function extractFilmstrip(
  mediaUrl: string,
  signal: AbortSignal,
): Promise<MediaFilmstrip> {
  const generated = await generateFilmstripSprite(mediaUrl, signal)
  return filmstripFromSpriteBlob(generated.blob, generated.durationMs)
}

async function generateFilmstripSprite(
  mediaUrl: string,
  signal: AbortSignal,
): Promise<{ blob: Blob; durationMs: number }> {
  const video = document.createElement("video")
  video.preload = "auto"
  video.muted = true
  video.playsInline = true
  // Keeps decoded frames drawable to canvas when the media is served from
  // the API origin; harmless for same-origin and object URLs.
  video.crossOrigin = "anonymous"

  try {
    const metadataLoaded = videoEvent(video, "loadedmetadata", {
      alreadyDone: () => video.readyState >= HTMLMediaElement.HAVE_METADATA,
      signal,
    })
    video.src = mediaUrl
    await metadataLoaded
    const durationSec = video.duration
    if (!Number.isFinite(durationSec) || !(durationSec > 0)) {
      throw new Error("Video duration is unavailable.")
    }

    const rows = Math.ceil(CLIP_SCRUBBER_FRAME_COUNT / CLIP_SCRUBBER_COLUMNS)
    let canvas: HTMLCanvasElement | null = null
    let ctx: CanvasRenderingContext2D | null = null
    for (let i = 0; i < FILMSTRIP_FRAME_COUNT; i++) {
      signal.throwIfAborted()
      try {
        const seeked = videoEvent(video, "seeked", { signal })
        video.currentTime =
          ((i + 0.5) / CLIP_SCRUBBER_FRAME_COUNT) * durationSec
        await seeked
      } catch (cause) {
        if (signal.aborted) throw cause
        continue
      }
      if (
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        !video.videoWidth ||
        !video.videoHeight
      ) {
        continue
      }
      if (!canvas) {
        const cellWidth = Math.max(
          1,
          Math.round(
            (video.videoWidth / video.videoHeight) * CLIP_SCRUBBER_FRAME_HEIGHT,
          ),
        )
        canvas = document.createElement("canvas")
        canvas.width = cellWidth * CLIP_SCRUBBER_COLUMNS
        canvas.height = CLIP_SCRUBBER_FRAME_HEIGHT * rows
        ctx = canvas.getContext("2d")
      }
      if (!canvas || !ctx) continue
      const cellWidth = canvas.width / CLIP_SCRUBBER_COLUMNS
      ctx.drawImage(
        video,
        0,
        0,
        video.videoWidth,
        video.videoHeight,
        (i % CLIP_SCRUBBER_COLUMNS) * cellWidth,
        Math.floor(i / CLIP_SCRUBBER_COLUMNS) * CLIP_SCRUBBER_FRAME_HEIGHT,
        cellWidth,
        CLIP_SCRUBBER_FRAME_HEIGHT,
      )
    }
    if (!canvas) throw new Error("No filmstrip frames could be decoded.")
    const blob = await canvasJpegBlob(canvas, FRAME_QUALITY)
    if (!blob) throw new Error("Could not encode filmstrip sprite.")
    return { blob, durationMs: Math.round(durationSec * 1000) }
  } finally {
    teardownVideoElement(video)
  }
}

async function filmstripFromSpriteBlob(
  blob: Blob,
  durationMs: number | null,
): Promise<MediaFilmstrip> {
  const url = URL.createObjectURL(blob)
  try {
    const strip = await extractSpriteFilmstrip(url)
    return { ...strip, durationMs }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Slice the server's scrubber sprite sheet into per-frame object URLs so the
 * trim bar consumes it exactly like a locally sampled strip. The sheet's
 * duration isn't knowable from the image — callers already have it from the
 * clip row.
 */
async function extractSpriteFilmstrip(
  sheetUrl: string,
): Promise<MediaFilmstrip> {
  const image = new Image()
  // The sheet route is owner-gated behind the session cookie, so the CORS
  // request must carry credentials on split-origin deployments; the server's
  // trusted-origin CORS config allows it, and it keeps the canvas untainted.
  image.crossOrigin = "use-credentials"
  image.decoding = "async"
  image.src = sheetUrl
  await image.decode()

  const rows = Math.ceil(CLIP_SCRUBBER_FRAME_COUNT / CLIP_SCRUBBER_COLUMNS)
  const cellWidth = Math.floor(image.naturalWidth / CLIP_SCRUBBER_COLUMNS)
  const cellHeight = Math.floor(image.naturalHeight / rows)
  if (!cellWidth || !cellHeight) return EMPTY_FILMSTRIP

  const frames: string[] = []
  for (let i = 0; i < CLIP_SCRUBBER_FRAME_COUNT; i++) {
    const canvas = document.createElement("canvas")
    canvas.width = cellWidth
    canvas.height = cellHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return EMPTY_FILMSTRIP
    ctx.drawImage(
      image,
      (i % CLIP_SCRUBBER_COLUMNS) * cellWidth,
      Math.floor(i / CLIP_SCRUBBER_COLUMNS) * cellHeight,
      cellWidth,
      cellHeight,
      0,
      0,
      cellWidth,
      cellHeight,
    )
    const blob = await canvasJpegBlob(canvas, FRAME_QUALITY)
    if (!blob) return EMPTY_FILMSTRIP
    frames.push(URL.createObjectURL(blob))
  }
  return {
    frames,
    aspect: cellWidth / cellHeight,
    durationMs: null,
  }
}
