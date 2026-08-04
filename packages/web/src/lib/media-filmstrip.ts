import { CLIP_SCRUBBER_FRAME_COUNT } from "@alloy/contracts"
import type { AlloyDesktop, RecordingLibraryItem } from "@alloy/contracts"
import { useEffect, useState } from "react"
import type { RefObject } from "react"

import { scheduleBackgroundMediaWork } from "./background-media-work"
import { clientLogger } from "./client-log"
import {
  EMPTY_FILMSTRIP,
  extractSpriteFilmstrip,
  filmstripFromSpriteBlob,
  generateFilmstripSprite,
  type MediaFilmstrip,
  type SpriteProgress,
} from "./media-filmstrip-sprite"

export type { MediaFilmstrip } from "./media-filmstrip-sprite"

/**
 * Renderer-side filmstrip sampling with two sources: evenly spaced frames
 * decoded by seeking a detached `<video>` element (local captures and picked
 * upload Files), or cells sliced from a server-rendered sprite sheet
 * (uploaded clips). Neither needs a client-side demuxer.
 */

export const FILMSTRIP_FRAME_COUNT = CLIP_SCRUBBER_FRAME_COUNT

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
  return cachedFilmstrip(mediaUrl, () => {
    const progress: SpriteProgress = { canvas: null, sampled: new Set() }
    return scheduleBackgroundMediaWork(
      `filmstrip:${mediaUrl}`,
      async (signal) =>
        filmstripFromSpriteBlob(
          await generateFilmstripSprite(mediaUrl, progress, signal),
        ),
    )
  })
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
  const key = `desktop-filmstrip:${item.id}:${item.modifiedAt}:${item.sizeBytes}`
  return cachedFilmstrip(key, () => {
    const progress: SpriteProgress = { canvas: null, sampled: new Set() }
    return scheduleBackgroundMediaWork(key, (signal) =>
      loadDesktopFilmstrip(desktop, item, progress, signal),
    )
  })
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
  progress: SpriteProgress,
  signal: AbortSignal,
): Promise<MediaFilmstrip> {
  const cached = await desktop.recording.getLibraryCaptureScrubber(item.id)
  if (cached) {
    try {
      return await filmstripFromSpriteBlob(
        new Blob([cached.slice().buffer], { type: "image/jpeg" }),
      )
    } catch {
      // A partial/corrupt cache entry is replaced by a fresh sprite below.
    }
  }

  const sprite = await generateFilmstripSprite(item.mediaUrl, progress, signal)
  // Persisting is an optimization. A failed write must not cost the caller the
  // strip that a full seek pass just produced, or an unwritable cache folder
  // would leave the trim editor permanently blank and regenerating forever.
  const bytes = new Uint8Array(await sprite.arrayBuffer())
  void desktop.recording
    .saveLibraryCaptureScrubber(item.id, bytes)
    .catch((cause: unknown) => {
      clientLogger.warn("[filmstrip] Could not cache the scrubber.", cause)
    })
  return filmstripFromSpriteBlob(sprite)
}
