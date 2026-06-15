export type QueueItemStatus =
  | "uploading"
  | "queued"
  | "paused"
  | "published"
  | "downloading"
  | "downloaded"
  | "failed"

/** Terminal, successful states - both clear out via "Clear completed". */
export function isCompletedQueueStatus(status: QueueItemStatus): boolean {
  return status === "published" || status === "downloaded"
}

export interface QueueItem {
  id: string
  title: string
  /** Which transport this row belongs to - drives the Uploads/Downloads split. */
  kind: "upload" | "download"
  status: QueueItemStatus
  /** 0-100. `queued` items should pass 0. */
  progress: number
  /** Second line of the row: "0:41 remaining", "H.264 1080p", etc. */
  detail: string
  /** Hue 0-360 - drives the thumbnail gradient placeholder. */
  hue: number
  thumbUrl?: string | null
  thumbBlurHash?: string | null
  thumbFallbackUrl?: string | null
  onThumbLoad?: () => void
  /** Optional callbacks the FlowController wires per row. */
  onCancel?: () => void
  onOpen?: () => void
  onCopyLink?: () => void
  /** Re-queues a failed desktop sync item. */
  onRetry?: () => void
  /** Removes a finished (published) row from the local view only. */
  onDismiss?: () => void
}
