/** Metadata derived from a real File for display in the modal header. */
export interface SelectedFile {
  /** The actual File the parent will upload. */
  file: File
  contentType: AcceptedContentType
  name: string
  size: string
  resolution: string
  fps: string
  duration: string
  /** ms — for the server's `/initiate` body and the trim UI. */
  durationMs: number
  width: number
  height: number
  sizeBytes: number
}

import {
  ACCEPTED_CLIP_CONTENT_TYPES,
  type AcceptedContentType,
  type ClipPrivacy,
} from "@workspace/api"

export type Visibility = ClipPrivacy

export interface PublishPayload {
  file: File
  /** Canonical server-accepted MIME — see `SelectedFile.contentType`. */
  contentType: AcceptedContentType
  title: string
  description: string | null
  gameId: string
  privacy: Visibility
  width: number
  height: number
  durationMs: number
  sizeBytes: number
  trimStartMs: number | null
  trimEndMs: number | null
  thumbBlob: Blob
  mentionedUserIds: string[]
}

const CONTENT_TYPE_ALIASES: Record<string, AcceptedContentType> = {
  "video/mp4": "video/mp4",
  "video/quicktime": "video/quicktime",
  "video/x-matroska": "video/x-matroska",
  "video/matroska": "video/x-matroska",
  "video/webm": "video/webm",
}

const EXTENSION_TO_CONTENT_TYPE: Record<string, AcceptedContentType> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
}

export const ACCEPT_LIST = `${ACCEPTED_CLIP_CONTENT_TYPES.join(",")},.mp4,.m4v,.mov,.mkv,.webm`

export function resolveContentType(file: File): AcceptedContentType | null {
  const byMime = CONTENT_TYPE_ALIASES[file.type]
  if (byMime) return byMime
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_TO_CONTENT_TYPE[ext] ?? null
}

export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".")
  return idx > 0 ? filename.slice(0, idx) : filename
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

const VIDEO_LOAD_TIMEOUT_MS = 15000
const THUMB_MAX_BYTES = 2 * 1024 * 1024
const THUMB_DIMENSIONS = [1280, 960, 720] as const
const THUMB_QUALITIES = [0.85, 0.75, 0.65] as const

function videoErrorMessage(video: HTMLVideoElement, fallback: string): string {
  const message = video.error?.message
  return message ? `${fallback}: ${message}` : fallback
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "loadeddata" | "seeked",
  failureMessage: string,
  isAlreadyReady?: () => boolean
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

function thumbnailSize(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

function encodeCanvasAsJpeg(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("canvas.toBlob returned null"))
      },
      "image/jpeg",
      quality
    )
  })
}

async function drawThumbnail(video: HTMLVideoElement): Promise<Blob> {
  const srcW = video.videoWidth
  const srcH = video.videoHeight
  if (!srcW || !srcH) {
    throw new Error("Video dimensions unavailable for thumbnail")
  }

  let lastBlob: Blob | null = null
  for (const maxDimension of THUMB_DIMENSIONS) {
    const { width, height } = thumbnailSize(srcW, srcH, maxDimension)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("2D canvas context unavailable")
    ctx.drawImage(video, 0, 0, width, height)

    for (const quality of THUMB_QUALITIES) {
      const blob = await encodeCanvasAsJpeg(canvas, quality)
      if (blob.size <= THUMB_MAX_BYTES) return blob
      lastBlob = blob
    }
  }

  if (lastBlob) return lastBlob
  throw new Error("Could not encode thumbnail")
}

export async function captureThumbnail(
  file: File,
  atMs: number,
  fallbackAtMs?: number
): Promise<Blob> {
  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  video.preload = "auto"
  video.muted = true
  video.playsInline = true

  const cleanup = () => {
    URL.revokeObjectURL(url)
    video.removeAttribute("src")
    try {
      video.load()
    } catch {
      // Some mobile browsers throw while tearing down blob-backed media.
    }
  }

  try {
    const metadataLoaded = waitForVideoEvent(
      video,
      "loadedmetadata",
      "Could not load video metadata for thumbnail capture",
      () => video.readyState >= HTMLMediaElement.HAVE_METADATA
    )
    video.src = url
    video.load()
    await metadataLoaded

    const duration = Number.isFinite(video.duration) ? video.duration : null
    const minTime = duration !== null && duration > 0.1 ? 0.001 : 0
    const maxTime =
      duration === null
        ? Math.max(0, atMs / 1000)
        : Math.max(0, duration - 0.05)
    const candidateTimes = uniqueThumbnailTimes(
      [atMs, fallbackAtMs, 1000, 100, 0],
      minTime,
      maxTime
    )
    let lastError: unknown = null

    for (const targetTime of candidateTimes) {
      try {
        if (Math.abs(video.currentTime - targetTime) > 0.0005) {
          const seeked = waitForVideoEvent(
            video,
            "seeked",
            "Seek failed during thumbnail capture"
          )
          video.currentTime = targetTime
          await seeked
        } else {
          await waitForVideoEvent(
            video,
            "loadeddata",
            "Could not load video frame for thumbnail capture",
            () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          )
        }

        return await drawThumbnail(video)
      } catch (err) {
        lastError = err
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Could not capture thumbnail")
  } finally {
    cleanup()
  }
}

const FRAME_JPEG_QUALITY = 0.72

/**
 * Grab `count` evenly-spaced frames from the video, each scaled down to
 * `maxWidth` px wide, as JPEG blobs. Feeds the advisory ML game-suggestion
 * model — cheap, best-effort, and never load-bearing, so we swallow
 * per-frame failures and return whatever we managed to capture.
 */
export async function captureFrames(
  file: File,
  { count, maxWidth }: { count: number; maxWidth: number }
): Promise<Blob[]> {
  if (count <= 0) return []

  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  video.preload = "auto"
  video.muted = true
  video.playsInline = true

  const cleanup = () => {
    URL.revokeObjectURL(url)
    video.removeAttribute("src")
    try {
      video.load()
    } catch {
      // Some mobile browsers throw while tearing down blob-backed media.
    }
  }

  try {
    const metadataLoaded = waitForVideoEvent(
      video,
      "loadedmetadata",
      "Could not load video metadata for frame capture",
      () => video.readyState >= HTMLMediaElement.HAVE_METADATA
    )
    video.src = url
    video.load()
    await metadataLoaded

    const srcW = video.videoWidth
    const srcH = video.videoHeight
    if (!srcW || !srcH) return []

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const times = evenlySpacedFrameTimes(duration, count)

    const { width, height } = thumbnailSize(srcW, srcH, maxWidth)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return []

    const frames: Blob[] = []
    for (const targetTime of times) {
      try {
        if (Math.abs(video.currentTime - targetTime) > 0.0005) {
          const seeked = waitForVideoEvent(
            video,
            "seeked",
            "Seek failed during frame capture"
          )
          video.currentTime = targetTime
          await seeked
        }
        ctx.drawImage(video, 0, 0, width, height)
        frames.push(await encodeCanvasAsJpeg(canvas, FRAME_JPEG_QUALITY))
      } catch {
        // Advisory feature — skip frames we can't grab and keep going.
      }
    }
    return frames
  } finally {
    cleanup()
  }
}

/**
 * Spread `count` sample points across the interior of the clip, skipping the
 * very start/end which are often black or mid-fade. e.g. count=4 →
 * 20%/40%/60%/80% of the duration.
 */
function evenlySpacedFrameTimes(
  durationSeconds: number,
  count: number
): number[] {
  if (durationSeconds <= 0.1) return [0]
  const times: number[] = []
  for (let i = 1; i <= count; i++) {
    const fraction = i / (count + 1)
    times.push(Number((durationSeconds * fraction).toFixed(3)))
  }
  return times
}

function uniqueThumbnailTimes(
  timesMs: Array<number | null | undefined>,
  minSeconds: number,
  maxSeconds: number
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

export type ProbedFile = Omit<SelectedFile, "contentType">

export function probeFile(file: File): Promise<ProbedFile> {
  return new Promise<ProbedFile>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    let settled = false
    let timeoutId = 0
    video.preload = "metadata"
    // Muted + playsInline avoids autoplay quirks on some browsers when
    // metadata loads kick the element into a playing state.
    video.muted = true
    video.playsInline = true

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      URL.revokeObjectURL(url)
      video.removeAttribute("src")
      try {
        video.load()
      } catch {
        // Some mobile browsers throw while tearing down blob-backed media.
      }
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
        reject(new Error("Could not read video metadata"))
        return
      }
      resolve({
        file,
        name: file.name,
        size: formatBytes(file.size),
        resolution: `${width}×${height}`,
        fps: "—FPS",
        duration: formatDuration(durationMs),
        durationMs,
        width,
        height,
        sizeBytes: file.size,
      })
    }
    video.onerror = () => {
      fail(videoErrorMessage(video, "Could not read video metadata"))
    }
    timeoutId = window.setTimeout(() => {
      fail("Timed out while reading video metadata")
    }, VIDEO_LOAD_TIMEOUT_MS)
    video.src = url
    video.load()
  })
}
