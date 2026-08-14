import { t } from "@alloy/i18n"
import { useMemo } from "react"

import { useUploadQueue } from "./upload-flow-context"
import { isCompletedQueueStatus, type QueueItem } from "./upload-queue-types"

export interface UploadQueueSummary {
  /** All visible queue rows, including completed and failed work. */
  items: QueueItem[]
  activeCount: number
  failedCount: number
  /** Aggregate percent across active rows that report determinate progress. */
  percent: number
  /** True when work is in flight but no row reports a numeric percent yet. */
  indeterminate: boolean
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
        item.status !== "failed" &&
        item.status !== "paused" &&
        !isCompletedQueueStatus(item.status),
    )
    const failedCount = queue.filter((item) => item.status === "failed").length
    const determinate = active.filter(
      (item) => item.showProgress !== false && !item.indeterminate,
    )
    const percent =
      determinate.length > 0
        ? Math.round(
            determinate.reduce(
              (sum, item) => sum + Math.max(0, Math.min(100, item.progress)),
              0,
            ) / determinate.length,
          )
        : 0

    return {
      items: queue,
      activeCount: active.length,
      failedCount,
      percent,
      indeterminate: active.length > 0 && determinate.length === 0,
      label: pillLabel(active, failedCount),
    }
  }, [queue])
}

function pillLabel(active: QueueItem[], failedCount: number): string {
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
