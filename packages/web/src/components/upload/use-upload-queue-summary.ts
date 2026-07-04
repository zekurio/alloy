import { t } from "@alloy/i18n"
import { useMemo } from "react"

import { isCompletedQueueStatus, type QueueItem } from "./upload-queue-types"
import { useUploadFlowControls } from "./use-upload-flow-controls"

export interface UploadQueueSummary {
  /** Active + failed rows worth surfacing (completed rows are dropped). */
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
 * Collapses the app-wide upload/download/processing queue into the compact
 * shape the global status pill needs. Returns null when nothing is in flight
 * so the pill can render nothing.
 */
export function useUploadQueueSummary(): UploadQueueSummary | null {
  const { queue } = useUploadFlowControls()
  return useMemo(() => {
    const relevant = queue.filter(
      (item) => !isCompletedQueueStatus(item.status),
    )
    if (relevant.length === 0) return null

    const active = relevant.filter((item) => item.status !== "failed")
    const failedCount = relevant.length - active.length
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
      items: relevant,
      activeCount: active.length,
      failedCount,
      percent,
      indeterminate: active.length > 0 && determinate.length === 0,
      label: pillLabel(active, failedCount),
    }
  }, [queue])
}

function pillLabel(active: QueueItem[], failedCount: number): string {
  if (active.length === 0) return t("{count} failed", { count: failedCount })
  if (active.some((item) => item.phase === "upload")) return t("Uploading…")
  if (active.some((item) => item.phase === "processing")) {
    return t("Processing clips")
  }
  if (active.some((item) => item.phase === "download")) return t("Downloading")
  return t("Uploading…")
}
