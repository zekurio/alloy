import { clipThumbnailUrl, type QueueClip } from "@workspace/api"
import { stableHue } from "@workspace/ui/lib/stable-hash"
import { apiOrigin } from "@/lib/env"
import { formatBytes } from "@/lib/storage-format"
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
  thumbUrl: string | null
}

export function localToQueueItem(
  e: ActiveUpload,
  onCancel: () => void,
): QueueItem {
  const pct = e.bytesTotal > 0
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
      detail = e.bytesTotal > 0
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

interface ServerRowHandlers {
  onCancel: () => void
  onOpen?: () => void
  onCopyLink?: () => void
  onDismiss?: () => void
  thumbFallbackUrl?: string | null
  onThumbLoad?: () => void
}

function queueThumbnailUrl(row: QueueClip): string | null {
  if (!row.hasThumb) return null
  return clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
}

export function serverToQueueItem(
  row: QueueClip,
  handlers: ServerRowHandlers,
): QueueItem {
  let status: QueueItemStatus
  let detail: string
  switch (row.status) {
    case "pending":
      status = "queued"
      detail = "Awaiting upload"
      break
    case "processing":
      status = "encoding"
      detail = "Processing clip"
      break
    case "ready":
      status = row.encodeProgress < 100 ? "encoding" : "published"
      detail = row.encodeProgress < 100
        ? "Publishing playback variants"
        : "Ready"
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
    progress: status === "encoding"
      ? row.encodeProgress
      : status === "published"
      ? 100
      : 0,
    detail,
    hue: stableHue(row.id),
    thumbUrl: queueThumbnailUrl(row),
    thumbFallbackUrl: handlers.thumbFallbackUrl,
    onThumbLoad: handlers.onThumbLoad,
    onCancel: handlers.onCancel,
    onOpen: handlers.onOpen,
    onCopyLink: handlers.onCopyLink,
    onDismiss: handlers.onDismiss,
  }
}
