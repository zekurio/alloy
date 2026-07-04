import { clipThumbnailUrl, type QueueClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { stableHue } from "@alloy/ui/lib/stable-hash"

import type { RecordingLibraryDownload } from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"
import { formatBytes } from "@/lib/storage-format"

import type { PublishPayload } from "./new-clip-helpers"
import { encodeStageLabel } from "./queue-progress"
import type { QueueItem, QueueItemStatus } from "./upload-queue-types"

export interface ActiveUpload {
  localId: string
  clipId?: string
  localCaptureId?: string
  serverClipCreated?: boolean
  title: string
  hue: number
  bytesTotal: number
  bytesLoaded: number
  status: "preparing" | "initiating" | "uploading" | "finalizing" | "error"
  errorMessage?: string
  abort: AbortController
  thumbUrl: string | null
  thumbBlurHash: string | null
  /** Retained after a prepared upload begins so a local failure can retry. */
  preparedPayload?: PublishPayload
}

interface LocalRowHandlers {
  onCancel: () => void
  onRetry?: () => void
}

export function localToQueueItem(
  e: ActiveUpload,
  handlers: LocalRowHandlers,
): QueueItem {
  // Byte progress is uncapped: 100% means the bytes are flushed. The entry then
  // flips to "finalizing" (an indeterminate wait for the server) and, once the
  // server row appears, to a server-driven processing row.
  const pct =
    e.bytesTotal > 0
      ? Math.min(100, Math.floor((e.bytesLoaded / e.bytesTotal) * 100))
      : 0
  let status: QueueItemStatus
  let label: string
  let detail = ""
  let progress = 0
  let showProgress = false
  let indeterminate = false
  switch (e.status) {
    case "preparing":
      status = "preparing"
      label = t("Preparing…")
      indeterminate = true
      break
    case "initiating":
      status = "queued"
      label = t("Reserving slot…")
      indeterminate = true
      break
    case "uploading":
      status = "uploading"
      progress = pct
      showProgress = true
      label = t("Uploading")
      detail =
        e.bytesTotal > 0
          ? `${formatBytes(e.bytesLoaded)} / ${formatBytes(e.bytesTotal)}`
          : ""
      break
    case "finalizing":
      status = "uploading"
      label = t("Finalizing upload…")
      indeterminate = true
      showProgress = true
      break
    case "error":
      status = "failed"
      label = t("Failed")
      detail = e.errorMessage ?? t("Upload failed")
      break
  }
  return {
    id: e.clipId ?? e.localId,
    localCaptureId: e.localCaptureId,
    title: e.title,
    kind: "upload",
    phase: "upload",
    status,
    progress,
    showProgress,
    indeterminate,
    label,
    detail,
    hue: e.hue,
    thumbUrl: e.thumbUrl,
    thumbBlurHash: e.thumbBlurHash,
    onCancel: handlers.onCancel,
    onRetry: handlers.onRetry,
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
  let label: string
  let detail = ""
  let progress = 0
  let showProgress = false
  let indeterminate = false
  switch (download.status) {
    case "downloading":
      status = "downloading"
      label = t("Downloading")
      showProgress = true
      if (download.totalBytes && download.totalBytes > 0) {
        progress = Math.min(
          100,
          Math.floor((download.receivedBytes / download.totalBytes) * 100),
        )
        detail = `${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}`
      } else {
        indeterminate = true
        detail = formatBytes(download.receivedBytes)
      }
      break
    case "completed":
      status = "downloaded"
      progress = 100
      label = t("Saved to library")
      break
    case "failed":
      status = "failed"
      label = t("Failed")
      detail = download.error ?? t("Download failed")
      break
  }
  return {
    id: `download:${download.clipId}`,
    title: download.title,
    kind: "download",
    phase: "download",
    status,
    progress,
    showProgress,
    indeterminate,
    label,
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
  onRetry?: () => void
  onDismiss?: () => void
  thumbFallbackUrl?: string | null
  onThumbLoad?: () => void
}

function queueThumbnailUrl(row: QueueClip): string | null {
  if (!row.hasThumb) return null
  return clipThumbnailUrl(row.id, apiOrigin(), row.thumbVersion ?? undefined)
}

export function serverToQueueItem(
  row: QueueClip,
  handlers: ServerRowHandlers,
): QueueItem {
  let status: QueueItemStatus
  let label: string
  let detail = ""
  let progress = 0
  let showProgress = false
  let indeterminate = false
  switch (row.status) {
    case "pending":
      status = "queued"
      label = t("Awaiting upload")
      indeterminate = true
      break
    case "processing":
      status = "uploading"
      // The server self-caps encodeProgress at 99 until the clip is ready, so
      // the client never needs to cap it again; 100 only ever means published.
      progress = Math.max(0, Math.min(100, Math.floor(row.encodeProgress)))
      showProgress = true
      indeterminate = progress <= 0
      label = encodeStageLabel({
        stage: row.encodeStage,
        tier: row.encodeTier,
        tierIndex: row.encodeTierIndex,
        tierCount: row.encodeTierCount,
      })
      break
    case "ready":
      status = "published"
      progress = 100
      label = t("Ready")
      break
    case "failed":
      status = "failed"
      label = t("Failed")
      detail = row.failureReason ?? t("Upload failed")
      break
  }
  return {
    id: row.id,
    title: row.title,
    kind: "upload",
    phase: row.status === "processing" ? "processing" : "upload",
    status,
    progress,
    showProgress,
    indeterminate,
    label,
    detail,
    hue: stableHue(row.gameId ?? row.id),
    thumbUrl: queueThumbnailUrl(row),
    thumbBlurHash: row.thumbBlurHash,
    thumbFallbackUrl: handlers.thumbFallbackUrl,
    onThumbLoad: handlers.onThumbLoad,
    onCancel: handlers.onCancel,
    onOpen: handlers.onOpen,
    onCopyLink: handlers.onCopyLink,
    onRetry: handlers.onRetry,
    onDismiss: handlers.onDismiss,
  }
}
