import { ALL_FORMATS, CanvasSink, Input } from "mediabunny"
import * as React from "react"

import { createCaptureSource } from "@/lib/capture-source"

/**
 * Renderer-side filmstrip sampling: evenly spaced frames decoded with
 * mediabunny over the same byte-range transport the preview engine uses, so
 * local captures (`alloy-capture://`) and uploaded clips (http stream) get
 * identical treatment and no ffmpeg is involved.
 */

export const FILMSTRIP_FRAME_COUNT = 16
/** Decode height of a strip frame; cells crop the rest with object-cover. */
const FRAME_HEIGHT = 96
const FRAME_QUALITY = 0.7

export interface MediaFilmstrip {
  /** Object URLs of evenly spaced frames; empty while loading or on failure. */
  frames: string[]
  /**
   * Duration measured from the media itself. More trustworthy than recorded
   * metadata, which can overshoot (replay saves report the requested buffer
   * window even when the buffer held less footage).
   */
  durationMs: number | null
}

const EMPTY_FILMSTRIP: MediaFilmstrip = { frames: [], durationMs: null }

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
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      // A gap (e.g. an undecodable region) just yields fewer cells; the
      // strip stretches the neighbors over it.
      if (wrapped) frames.push(await canvasObjectUrl(wrapped.canvas))
    }
    return { frames, durationMs: Math.round(durationSec * 1000) }
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
