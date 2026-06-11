import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import { extname } from "node:path"

import type { RecordingCaptureKind } from "@alloy/contracts"

export const MEDIA_PROTOCOL = "alloy-capture"
export const MEDIA_HOST = "media"
export const THUMBNAIL_HOST = "thumbnail"
export const FILMSTRIP_HOST = "filmstrip"
export const EXPORT_HOST = "export"
/** Frames sampled per capture for the editor timeline filmstrip. */
export const FILMSTRIP_FRAME_COUNT = 16
export const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".mov", ".webm"])
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"])

export function captureId(filename: string): string {
  return createHash("sha256")
    .update(process.platform === "win32" ? filename.toLowerCase() : filename)
    .digest("base64url")
    .slice(0, 22)
}

export function thumbnailSignature(id: string, stat: Stats): string {
  return `${id}-${Math.round(stat.mtimeMs)}-${stat.size}`
}

export function titleForCapture(
  kind: RecordingCaptureKind,
  createdAt: string,
): string {
  const date = new Date(createdAt)
  const time = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
  if (kind === "long-recording") return `Session ${time}`
  if (kind === "screenshot") return `Screenshot ${time}`
  return `Clip ${time}`
}

export function clampMs(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function ffmpegSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3)
}

export function contentTypeForFile(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".mp4":
      return "video/mp4"
    case ".mov":
      return "video/quicktime"
    case ".mkv":
      return "video/x-matroska"
    case ".webm":
      return "video/webm"
    default:
      return "application/octet-stream"
  }
}
