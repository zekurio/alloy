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
  /** Coarse phase for aggregate labels (e.g. the global pill). */
  phase?: "upload" | "processing" | "download"
  status: QueueItemStatus
  /** 0-100. `queued` items should pass 0. */
  progress: number
  /** False for handoff states that have no meaningful numeric progress. */
  showProgress?: boolean
  /**
   * True while progress is real but not yet numerically meaningful — bytes
   * flushed and awaiting the server, or an encode that has not reported a
   * percentage yet. Surfaces render an indeterminate sweep instead of a 0% bar.
   */
  indeterminate?: boolean
  /** Short phase label ("Uploading", "Encoding 1080p (2/3)", "Failed"). */
  label?: string
  /** Longer status detail: byte counts, an error message, etc. */
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
