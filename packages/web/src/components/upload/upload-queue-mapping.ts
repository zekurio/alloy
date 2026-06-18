import { clipThumbnailUrl, type QueueClip } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { stableHue } from "@alloy/ui/lib/stable-hash"

import type { RecordingLibraryDownload } from "@/lib/desktop"
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
  thumbBlurHash: string | null
}

export function localToQueueItem(
  e: ActiveUpload,
  onCancel: () => void,
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
          : tx("Uploading…")
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
    kind: "upload",
    status,
    progress: status === "uploading" ? pct : 0,
    detail,
    hue: e.hue,
    thumbUrl: e.thumbUrl,
    thumbBlurHash: e.thumbBlurHash,
    onCancel,
  }
}

interface DownloadHandlers {
  onCancel: () => void
  /** Reveals the saved file in the OS file manager. */
  onOpen?: () => void
  onDismiss?: () => void
}

/** A clip being persisted into the local capture library (desktop only). */
export function downloadToQueueItem(
  download: RecordingLibraryDownload,
  handlers: DownloadHandlers,
): QueueItem {
  let status: QueueItemStatus
  let detail: string
  let progress: number
  switch (download.status) {
    case "downloading":
      status = "downloading"
      progress =
        download.totalBytes && download.totalBytes > 0
          ? Math.min(
              99,
              Math.floor((download.receivedBytes / download.totalBytes) * 100),
            )
          : 0
      detail = download.totalBytes
        ? `${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}`
        : formatBytes(download.receivedBytes)
      break
    case "completed":
      status = "downloaded"
      progress = 100
      detail = "Saved to library"
      break
    case "failed":
      status = "failed"
      progress = 0
      detail = download.error ?? "Download failed"
      break
  }
  return {
    id: `download:${download.clipId}`,
    title: download.title,
    kind: "download",
    status,
    progress,
    detail,
    hue: stableHue(download.clipId),
    thumbUrl: clipThumbnailUrl(download.clipId, apiOrigin()),
    onCancel: handlers.onCancel,
    onOpen: handlers.onOpen,
    onDismiss: handlers.onDismiss,
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
  let progress = 0
  switch (row.status) {
    case "pending":
      status = "queued"
      detail = "Awaiting upload"
      break
    // Packaging is a quick stream-copy, not a transcode — show it as the
    // tail end of the upload rather than a separate "Processing" stage.
    case "processing":
      status = "uploading"
      progress = 99
      detail = "Finalizing…"
      break
    case "ready":
      status = "published"
      progress = 100
      detail = "Ready"
      break
    case "failed":
      status = "failed"
      detail = row.failureReason ?? "Upload failed"
      break
  }
  return {
    id: row.id,
    title: row.title,
    kind: "upload",
    status,
    progress,
    detail,
    hue: stableHue(row.steamgriddbId ?? row.id),
    thumbUrl: queueThumbnailUrl(row),
    thumbBlurHash: row.thumbBlurHash,
    thumbFallbackUrl: handlers.thumbFallbackUrl,
    onThumbLoad: handlers.onThumbLoad,
    onCancel: handlers.onCancel,
    onOpen: handlers.onOpen,
    onCopyLink: handlers.onCopyLink,
    onDismiss: handlers.onDismiss,
  }
}
