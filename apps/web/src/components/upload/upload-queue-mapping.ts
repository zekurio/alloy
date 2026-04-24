import type { QueueClip } from "@workspace/api"
import { clipThumbnailUrl } from "@workspace/api"
import type { QueueItem, QueueItemStatus } from "./upload-queue"

export interface ActiveUpload {
  localId: string
  clipId?: string
  title: string
  hue: number
  bytesTotal: number
  bytesLoaded: number
  status: "initiating" | "uploading" | "finalizing" | "error"
  errorMessage?: string
  abort: AbortController
  thumbUrl: string
}

export function hueFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return h % 360
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function localToQueueItem(
  e: ActiveUpload,
  onCancel: () => void
): QueueItem {
  const pct =
    e.bytesTotal > 0
      ? Math.min(99, Math.floor((e.bytesLoaded / e.bytesTotal) * 100))
      : 0
  let status: QueueItemStatus
  let detail: string
  switch (e.status) {
    case "initiating":
      status = "queued"
      detail = "Reserving slot…"
      break
    case "uploading":
      status = "uploading"
      detail =
        e.bytesTotal > 0
          ? `${formatBytes(e.bytesLoaded)} / ${formatBytes(e.bytesTotal)}`
          : "Uploading…"
      break
    case "finalizing":
      status = "uploading"
      detail = "Finalizing…"
      break
    case "error":
      status = "failed"
      detail = e.errorMessage ?? "Upload failed"
      break
  }
  return {
    id: e.localId,
    title: e.title,
    status,
    progress: status === "uploading" ? pct : 0,
    detail,
    hue: e.hue,
    thumbUrl: e.thumbUrl,
    onCancel,
  }
}

export interface ServerRowHandlers {
  onCancel: () => void
  onOpen?: () => void
  onCopyLink?: () => void
  onDismiss?: () => void
  thumbFallbackUrl?: string | null
  onThumbLoad?: () => void
}

export function serverToQueueItem(
  row: QueueClip,
  handlers: ServerRowHandlers
): QueueItem {
  let status: QueueItemStatus
  let detail: string
  switch (row.status) {
    case "pending":
      status = "queued"
      detail = "Awaiting upload"
      break
    case "uploaded":
      status = "queued"
      detail = "Queued for encoder"
      break
    case "encoding":
      status = "encoding"
      detail = "Transcoding video"
      break
    case "ready":
      status = "published"
      detail = "Ready"
      break
    case "failed":
      status = "failed"
      detail = row.failureReason ?? "Encoding failed"
      break
  }
  return {
    id: row.id,
    title: row.title,
    status,
    progress:
      status === "encoding"
        ? row.encodeProgress
        : status === "published"
          ? 100
          : 0,
    detail,
    hue: hueFor(row.id),
    thumbUrl: clipThumbnailUrl(row.id),
    thumbFallbackUrl: handlers.thumbFallbackUrl,
    onThumbLoad: handlers.onThumbLoad,
    onCancel: handlers.onCancel,
    onOpen: handlers.onOpen,
    onCopyLink: handlers.onCopyLink,
    onDismiss: handlers.onDismiss,
  }
}
