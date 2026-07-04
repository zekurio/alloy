import { t } from "@alloy/i18n"
import { canvasBlurHash } from "@alloy/ui/lib/blurhash-encode"

import { formatMediaDurationMs } from "@/lib/media-time"
import { requireObjectUrl, revokeObjectUrl } from "@/lib/object-url"
import { formatBytes } from "@/lib/storage-format"

import type { SelectedFile } from "./new-clip-helpers"

const VIDEO_LOAD_TIMEOUT_MS = 15000
const THUMB_MAX_BYTES = 2 * 1024 * 1024
const THUMB_DIMENSIONS = [1280, 960, 720] as const
const THUMB_QUALITIES = [0.85, 0.75, 0.65] as const

type VideoEventName = "loadedmetadata" | "loadeddata" | "seeked"

type VideoSession = {
  video: HTMLVideoElement
  cleanup: () => void
}

export interface CapturedThumbnail {
  blob: Blob
  blurHash: string | null
}

export type ProbedFile = Omit<SelectedFile, "contentType">

export async function captureThumbnail(
  file: File,
  atMs: number,
  fallbackAtMs?: number,
  // Floor for every retry candidate — a trimmed upload's poster must never
  // sample a frame before the kept range even when the requested seeks fail.
  minMs = 0,
): Promise<CapturedThumbnail> {
  const { video, cleanup } = createVideoSession(file, "auto")

  try {
    await loadVideoMetadata(
      video,
      t("Could not load video metadata for thumbnail capture"),
    )

    const duration = Number.isFinite(video.duration) ? video.duration : null
    const minTime = Math.max(
      minMs / 1000,
      duration !== null && duration > 0.1 ? 0.001 : 0,
    )
    const maxTime =
      duration === null
        ? Math.max(minTime, atMs / 1000)
        : Math.max(minTime, duration - 0.05)
    const candidateTimes = uniqueThumbnailTimes(
      [atMs, fallbackAtMs, 1000, 100, 0],
      minTime,
      maxTime,
    )
    let lastError: unknown = null

    for (const targetTime of candidateTimes) {
      try {
        if (
          await seekVideo(
            video,
            targetTime,
            t("Seek failed during thumbnail capture"),
          )
        ) {
          return await drawThumbnail(video)
        }

        await waitForVideoEvent(
          video,
          "loadeddata",
          t("Could not load video frame for thumbnail capture"),
          () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
        )
        return await drawThumbnail(video)
      } catch (err) {
        lastError = err
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(t("Could not capture thumbnail"))
  } finally {
    cleanup()
  }
}

/**
 * Builds the upload poster from an already-rendered image, preserving the
 * cached capture poster when one is available.
 */
export async function thumbnailFromImageUrl(
  url: string,
): Promise<CapturedThumbnail> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      t("Could not fetch poster image ({status})", {
        status: response.status,
      }),
    )
  }
  const bitmap = await createImageBitmap(await response.blob())
  try {
    return await encodeThumbnail(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

export function probeFile(file: File): Promise<ProbedFile> {
  return new Promise<ProbedFile>((resolve, reject) => {
    const { video, cleanup: cleanupVideo } = createVideoSession(
      file,
      "metadata",
    )
    let settled = false
    let timeoutId = 0
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      cleanupVideo()
    }

    const fail = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }

    video.onloadedmetadata = () => {
      if (settled) return
      settled = true
      const width = video.videoWidth
      const height = video.videoHeight
      const durationMs = Math.round((video.duration || 0) * 1000)
      cleanup()
      if (!width || !height || !durationMs) {
        reject(new Error(t("Could not read video metadata")))
        return
      }
      resolve({
        file,
        name: file.name,
        size: formatBytes(file.size),
        resolution: `${width}×${height}`,
        fps: "—FPS",
        duration: formatMediaDurationMs(durationMs),
        durationMs,
        width,
        height,
        sizeBytes: file.size,
      })
    }
    video.onerror = () => {
      fail(videoErrorMessage(video, t("Could not read video metadata")))
    }
    timeoutId = window.setTimeout(() => {
      fail(t("Timed out while reading video metadata"))
    }, VIDEO_LOAD_TIMEOUT_MS)
    video.load()
  })
}

function createVideoSession(
  file: File,
  preload: HTMLVideoElement["preload"],
): VideoSession {
  const url = requireObjectUrl(file, "video file URL")
  const video = document.createElement("video")
  video.preload = preload
  video.muted = true
  video.playsInline = true
  video.src = url

  return {
    video,
    cleanup: () => {
      revokeObjectUrl(url, "video file URL")
      video.removeAttribute("src")
      try {
        video.load()
      } catch {
        // Some mobile browsers throw while tearing down blob-backed media.
      }
    },
  }
}

async function loadVideoMetadata(
  video: HTMLVideoElement,
  failureMessage: string,
): Promise<void> {
  const metadataLoaded = waitForVideoEvent(
    video,
    "loadedmetadata",
    failureMessage,
    () => video.readyState >= HTMLMediaElement.HAVE_METADATA,
  )
  video.load()
  await metadataLoaded
}

function videoErrorMessage(video: HTMLVideoElement, fallback: string): string {
  const message = video.error?.message
  return message ? t("{fallback}: {message}", { fallback, message }) : fallback
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: VideoEventName,
  failureMessage: string,
  isAlreadyReady?: () => boolean,
): Promise<void> {
  if (isAlreadyReady?.()) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let timeoutId = 0
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
      reject(new Error(videoErrorMessage(video, failureMessage)))
    }
    timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error(failureMessage))
    }, VIDEO_LOAD_TIMEOUT_MS)
    video.addEventListener(eventName, onEvent, { once: true })
    video.addEventListener("error", onError, { once: true })
  })
}

async function seekVideo(
  video: HTMLVideoElement,
  targetTime: number,
  failureMessage: string,
): Promise<boolean> {
  if (Math.abs(video.currentTime - targetTime) <= 0.0005) {
    return false
  }

  const seeked = waitForVideoEvent(video, "seeked", failureMessage)
  video.currentTime = targetTime
  await seeked
  return true
}

function thumbnailSize(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

// Clip posters are standardized on JPEG so uploaded and local-only thumbnails
// use the same broadly inspectable image format.
function encodeCanvasAsJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error(t("canvas.toBlob returned null")))
      },
      "image/jpeg",
      quality,
    )
  })
}

async function drawThumbnail(
  video: HTMLVideoElement,
): Promise<CapturedThumbnail> {
  const srcW = video.videoWidth
  const srcH = video.videoHeight
  if (!srcW || !srcH) {
    throw new Error(t("Video dimensions unavailable for thumbnail"))
  }
  return encodeThumbnail(video, srcW, srcH)
}

async function encodeThumbnail(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): Promise<CapturedThumbnail> {
  if (!srcW || !srcH) {
    throw new Error(t("Source dimensions unavailable for thumbnail"))
  }

  let lastThumbnail: CapturedThumbnail | null = null
  for (const maxDimension of THUMB_DIMENSIONS) {
    const { width, height } = thumbnailSize(srcW, srcH, maxDimension)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error(t("2D canvas context unavailable"))
    ctx.drawImage(source, 0, 0, width, height)
    const blurHash = safeCanvasBlurHash(canvas)

    for (const quality of THUMB_QUALITIES) {
      const blob = await encodeCanvasAsJpeg(canvas, quality)
      const thumbnail = { blob, blurHash }
      if (blob.size <= THUMB_MAX_BYTES) return thumbnail
      lastThumbnail = thumbnail
    }
  }

  if (lastThumbnail) return lastThumbnail
  throw new Error(t("Could not encode thumbnail"))
}

function safeCanvasBlurHash(canvas: HTMLCanvasElement): string | null {
  try {
    return canvasBlurHash(canvas)
  } catch {
    return null
  }
}

function uniqueThumbnailTimes(
  timesMs: Array<number | null | undefined>,
  minSeconds: number,
  maxSeconds: number,
): number[] {
  const result: number[] = []
  for (const ms of timesMs) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) continue
    const seconds = Math.min(Math.max(minSeconds, ms / 1000), maxSeconds)
    if (result.every((existing) => Math.abs(existing - seconds) > 0.05)) {
      result.push(seconds)
    }
  }
  return result.length > 0 ? result : [minSeconds]
}
