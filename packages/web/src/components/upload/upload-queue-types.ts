export type QueueItemStatus =
  | "preparing"
  | "uploading"
  | "queued"
  | "paused"
  | "published"
  | "downloading"
  | "downloaded"
  | "failed"

/** Terminal, successful states. */
export function isCompletedQueueStatus(status: QueueItemStatus): boolean {
  return status === "published" || status === "downloaded"
}

export interface QueueItem {
  id: string
  localCaptureId?: string
  title: string
  /** Which transport this row belongs to. */
  kind: "upload" | "download"
  status: QueueItemStatus
  /** 0-100. `queued` items should pass 0. */
  progress: number
  /** False for handoff states that have no meaningful numeric progress. */
  showProgress?: boolean
  /** Short status detail: "0:41 remaining", "H.264 1080p", etc. */
  detail: string
  /** Hue 0-360, retained for thumbnail placeholders where needed. */
  hue: number
  thumbUrl?: string | null
  thumbBlurHash?: string | null
  thumbFallbackUrl?: string | null
  onThumbLoad?: () => void
  onCancel?: () => void
  onOpen?: () => void
  onCopyLink?: () => void
  onRetry?: () => void
  onDismiss?: () => void
}
