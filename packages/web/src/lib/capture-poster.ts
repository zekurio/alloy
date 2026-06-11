import { ALL_FORMATS, CanvasSink, Input } from "mediabunny"
import * as React from "react"

import { createCaptureSource } from "@/lib/capture-source"
import { alloyDesktop, notifyLibraryCapturesChanged } from "@/lib/desktop"
import { createObjectUrl } from "@/lib/object-url"

import { clientLogger } from "./client-log"

const POSTER_HEIGHT = 360
const POSTER_QUALITY = 0.82

interface CapturePosterOptions {
  id: string
  mediaUrl: string | null
  thumbnailUrl: string | null
  durationMs: number | null
  enabled?: boolean
}

interface ResolvedCapturePosterOptions {
  id: string
  mediaUrl: string
  thumbnailUrl: string
  durationMs: number | null
}

const posterCache = new Map<string, Promise<string | null>>()

export function useCapturePoster({
  id,
  mediaUrl,
  thumbnailUrl,
  durationMs,
  enabled = true,
}: CapturePosterOptions): string | null {
  const [poster, setPoster] = React.useState(thumbnailUrl)

  React.useEffect(() => {
    setPoster(thumbnailUrl)
    if (!enabled || !mediaUrl || !thumbnailUrl) return

    let cancelled = false
    const key = `${id}:${thumbnailUrl}`
    let pending = posterCache.get(key)
    if (!pending) {
      pending = resolveCapturePoster({
        id,
        mediaUrl,
        thumbnailUrl,
        durationMs,
      }).catch((cause) => {
        posterCache.delete(key)
        clientLogger.warn("[capture-poster] Could not render poster.", cause)
        return null
      })
      posterCache.set(key, pending)
    }

    void pending.then((url) => {
      if (!cancelled && url) setPoster(url)
    })

    return () => {
      cancelled = true
    }
  }, [durationMs, enabled, id, mediaUrl, thumbnailUrl])

  return poster
}

async function resolveCapturePoster({
  id,
  mediaUrl,
  thumbnailUrl,
  durationMs,
}: ResolvedCapturePosterOptions): Promise<string | null> {
  if (await thumbnailExists(thumbnailUrl)) return null

  const blob = await capturePosterBlob(mediaUrl, durationMs)
  if (!blob) return null

  const url = createObjectUrl(blob, "capture poster URL")
  if (!url) return null

  void persistPoster(id, blob)
  return url
}

async function thumbnailExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    if (response.status === 404) return false
    return response.ok
  } catch {
    return false
  }
}

async function capturePosterBlob(
  mediaUrl: string,
  durationMs: number | null,
): Promise<Blob | null> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: createCaptureSource(mediaUrl),
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) return null

    const durationSec =
      durationMs && durationMs > 0
        ? durationMs / 1000
        : await input.computeDuration()
    if (!(durationSec > 0)) return null

    const sink = new CanvasSink(track, { height: POSTER_HEIGHT })
    const timestamp = Math.min(1, durationSec / 2)
    for await (const wrapped of sink.canvasesAtTimestamps([timestamp])) {
      if (!wrapped) continue
      return canvasJpegBlob(wrapped.canvas)
    }
    return null
  } finally {
    input.dispose()
  }
}

async function canvasJpegBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob> {
  if (
    typeof OffscreenCanvas !== "undefined" &&
    canvas instanceof OffscreenCanvas
  ) {
    return canvas.convertToBlob({
      type: "image/jpeg",
      quality: POSTER_QUALITY,
    })
  }

  const htmlCanvas = canvas as HTMLCanvasElement
  return new Promise<Blob>((resolve, reject) => {
    htmlCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("canvas.toBlob returned null"))
      },
      "image/jpeg",
      POSTER_QUALITY,
    )
  })
}

async function persistPoster(id: string, blob: Blob): Promise<void> {
  const desktop = alloyDesktop()
  if (!desktop) return
  try {
    await desktop.recording.saveLibraryCaptureThumbnail(
      id,
      new Uint8Array(await blob.arrayBuffer()),
    )
    notifyLibraryCapturesChanged()
  } catch (cause) {
    clientLogger.warn("[capture-poster] Could not save poster.", cause)
  }
}
