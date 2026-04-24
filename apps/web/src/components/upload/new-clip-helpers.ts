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

/**
 * `M:SS.cs` for the trim/preview UI. Centiseconds give the user enough
 * precision to land on a specific moment without flooding the display.
 */
export function formatTimecode(ms: number): string {
  const safe = Math.max(0, Math.round(ms))
  const totalSec = Math.floor(safe / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const cs = Math.floor((safe % 1000) / 10)
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`
}

export async function captureThumbnail(
  file: File,
  atMs: number
): Promise<Blob> {
  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  video.preload = "auto"
  video.muted = true
  video.playsInline = true
  // Without `crossOrigin` the element treats blob: as same-origin, which
  // is what we want — canvas reads stay non-tainted.
  video.src = url

  const cleanup = () => {
    URL.revokeObjectURL(url)
    video.removeAttribute("src")
    video.load()
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener("loadeddata", onLoaded)
        video.removeEventListener("error", onError)
        resolve()
      }
      const onError = () => {
        video.removeEventListener("loadeddata", onLoaded)
        video.removeEventListener("error", onError)
        reject(new Error("Could not load video for thumbnail capture"))
      }
      video.addEventListener("loadeddata", onLoaded)
      video.addEventListener("error", onError)
    })

    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked)
        video.removeEventListener("error", onError)
        resolve()
      }
      const onError = () => {
        video.removeEventListener("seeked", onSeeked)
        video.removeEventListener("error", onError)
        reject(new Error("Seek failed during thumbnail capture"))
      }
      video.addEventListener("seeked", onSeeked)
      video.addEventListener("error", onError)
      video.currentTime = Math.max(0, atMs / 1000)
    })

    const srcW = video.videoWidth
    const srcH = video.videoHeight
    if (!srcW || !srcH) {
      throw new Error("Video dimensions unavailable for thumbnail")
    }

    const canvas = document.createElement("canvas")
    canvas.width = srcW
    canvas.height = srcH
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("2D canvas context unavailable")
    ctx.drawImage(video, 0, 0, srcW, srcH)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error("canvas.toBlob returned null"))
        },
        "image/jpeg",
        0.85
      )
    })
  } finally {
    cleanup()
  }
}

export type ProbedFile = Omit<SelectedFile, "contentType">

export function probeFile(file: File): Promise<ProbedFile> {
  return new Promise<ProbedFile>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    video.preload = "metadata"
    // Muted + playsInline avoids autoplay quirks on some browsers when
    // metadata loads kick the element into a playing state.
    video.muted = true
    video.playsInline = true

    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute("src")
      video.load()
    }

    video.onloadedmetadata = () => {
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
      cleanup()
      reject(new Error("Could not read video metadata"))
    }
    video.src = url
  })
}
