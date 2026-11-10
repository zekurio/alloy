import { t } from "@alloy/i18n"
import { useMemo } from "react"

import { useUploadQueue } from "./upload-flow-context"
import { isCompletedQueueStatus, type QueueItem } from "./upload-queue-types"

export interface UploadQueueSummary {
  /** All visible queue rows, including completed and failed work. */
  items: QueueItem[]
  activeCount: number
  failedCount: number
  label: string
}

/**
 * Collapses the app-wide upload/download queue into the compact shape the
 * upload center needs. Returns null only when the queue has no visible rows.
 */
export function useUploadQueueSummary(): UploadQueueSummary | null {
  const { queue } = useUploadQueue()
  return useMemo(() => {
    if (queue.length === 0) return null

    const active = queue.filter(
      (item) =>
        item.status !== "failed" && !isCompletedQueueStatus(item.status),
    )
    const failedCount = queue.filter((item) => item.status === "failed").length

    return {
      items: queue,
      activeCount: active.length,
      failedCount,
      label: summaryLabel(active, failedCount),
    }
  }, [queue])
}

function summaryLabel(active: QueueItem[], failedCount: number): string {
  if (active.length === 0 && failedCount > 0) {
    return t("{count} failed", { count: failedCount })
  }
  if (active.length === 0) return t("No active jobs")
  if (active.some((item) => item.phase === "upload")) return t("Uploading…")
  if (active.some((item) => item.phase === "processing")) {
    return t("Processing…")
  }
  if (active.some((item) => item.phase === "download")) return t("Downloading")
  return t("Uploading…")
}
