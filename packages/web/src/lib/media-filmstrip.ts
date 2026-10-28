import { useEffect, useState } from "react"

import {
  boundedMediaRetryDelay,
  mediaRequestCredentials,
} from "./media-waveform"

/** Frames sampled across the whole source. */
const FRAME_COUNT = 14
/** Rendered frame height; tiles are under 50 CSS px tall at 2x density. */
const FRAME_HEIGHT_PX = 96
/** Maximum source bytes kept by Mediabunny while it reads one filmstrip. */
const MAX_SOURCE_CACHE_BYTES = 8 * 1024 * 1024
/** Keep completed filmstrips bounded when a page visits many editors. */
const MAX_FILMSTRIP_CACHE_ENTRIES = 8

export interface FilmstripFrame {
  /** Position of the frame on the player's zero-based timeline. */
  timeMs: number
  /** Small JPEG data URL. */
  url: string
}

export type MediaFilmstripStatus = "idle" | "loading" | "ready" | "error"

export interface MediaFilmstripState {
  status: MediaFilmstripStatus
  /** Frames in time order; fills in while the strip loads. */
  frames: FilmstripFrame[]
}

const IDLE_FILMSTRIP: MediaFilmstripState = { status: "idle", frames: [] }
const filmstripCache = new Map<string, FilmstripFrame[]>()

/**
 * Loads a strip of video frames for a trimmer. Each frame is the key frame
 * nearest an even sample point, so the strip costs one decoded packet per
 * frame instead of decoding the source. `offsetMs` is where the player's
 * timeline starts inside the media, for sources that play a window of a file.
 * Browsers without WebCodecs end in `error` and keep an empty strip.
 */
export function useMediaFilmstrip(
  mediaUrl: string | null,
  cacheKey: string | null,
  durationMs: number,
  offsetMs = 0,
): MediaFilmstripState {
  const key =
    mediaUrl && cacheKey && durationMs > 0
      ? `${cacheKey}:${Math.round(durationMs)}:${Math.round(offsetMs)}`
      : null
  const [state, setState] = useState<{
    key: string | null
    filmstrip: MediaFilmstripState
  }>(() => ({ key, filmstrip: initialFilmstrip(key) }))
  // A new source starts over from its cached strip, or from nothing.
  if (state.key !== key) {
    setState({ key, filmstrip: initialFilmstrip(key) })
  }

  useEffect(() => {
    if (!key || !mediaUrl || filmstripCache.has(key)) return
    const controller = new AbortController()
    const frames: FilmstripFrame[] = []
    void loadFilmstrip(
      mediaUrl,
      durationMs,
      offsetMs,
      controller.signal,
      (frame) => {
        frames.push(frame)
        const snapshot = frames.slice()
        setState((current) =>
          current.key === key
            ? { key, filmstrip: { status: "loading", frames: snapshot } }
            : current,
        )
      },
    ).then(
      () => {
        if (controller.signal.aborted) return
        cacheFilmstrip(key, frames)
        setState((current) =>
          current.key === key
            ? { key, filmstrip: { status: "ready", frames: frames.slice() } }
            : current,
        )
      },
      () => {
        if (controller.signal.aborted) return
        setState((current) =>
          current.key === key
            ? { key, filmstrip: { status: "error", frames: frames.slice() } }
            : current,
        )
      },
    )
    return () => controller.abort()
  }, [durationMs, key, mediaUrl, offsetMs])

  return state.key === key ? state.filmstrip : initialFilmstrip(key)
}

function initialFilmstrip(key: string | null): MediaFilmstripState {
  if (!key) return IDLE_FILMSTRIP
  const cached = filmstripCache.get(key)
  return cached
    ? { status: "ready", frames: cached }
    : { status: "loading", frames: [] }
}

function cacheFilmstrip(key: string, frames: FilmstripFrame[]) {
  filmstripCache.delete(key)
  filmstripCache.set(key, frames)
  while (filmstripCache.size > MAX_FILMSTRIP_CACHE_ENTRIES) {
    const oldest = filmstripCache.keys().next().value
    if (oldest === undefined) break
    filmstripCache.delete(oldest)
  }
}

async function loadFilmstrip(
  mediaUrl: string,
  durationMs: number,
  offsetMs: number,
  signal: AbortSignal,
  onFrame: (frame: FilmstripFrame) => void,
): Promise<void> {
  const { ALL_FORMATS, CanvasSink, EncodedPacketSink, Input, UrlSource } =
    await import("mediabunny")
  const input = new Input({
    source: new UrlSource(mediaUrl, {
      maxCacheSize: MAX_SOURCE_CACHE_BYTES,
      parallelism: 2,
      requestInit: { credentials: mediaRequestCredentials(mediaUrl) },
      fetchFn: (request, init) =>
        fetch(request, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([signal, init.signal])
            : signal,
        }),
      getRetryDelay: boundedMediaRetryDelay,
    }),
    formats: ALL_FORMATS,
  })
  const abort = () => input.dispose()
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()

  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) {
      throw new Error("Video track can't be decoded for a filmstrip")
    }
    const packets = new EncodedPacketSink(track)
    const offsetSeconds = offsetMs / 1000
    const stepSeconds = durationMs / 1000 / FRAME_COUNT
    const keyTimes = new Set<number>()
    for (let index = 0; index < FRAME_COUNT; index++) {
      const target = offsetSeconds + (index + 0.5) * stepSeconds
      const packet = await packets.getKeyPacket(target, { metadataOnly: true })
      keyTimes.add(packet?.timestamp ?? target)
    }

    const sink = new CanvasSink(track, { height: FRAME_HEIGHT_PX })
    const timestamps = [...keyTimes].toSorted((left, right) => left - right)
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (signal.aborted) return
      if (!wrapped) continue
      onFrame({
        timeMs: Math.max(0, (wrapped.timestamp - offsetSeconds) * 1000),
        url: await canvasDataUrl(wrapped.canvas),
      })
    }
  } finally {
    signal.removeEventListener("abort", abort)
    input.dispose()
  }
}

async function canvasDataUrl(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<string> {
  if (canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL("image/jpeg", 0.72)
  }
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(reader.error ?? new Error("Frame read failed"))
    reader.readAsDataURL(blob)
  })
}
