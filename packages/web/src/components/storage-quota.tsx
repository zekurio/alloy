import { t as tx } from "@alloy/i18n"
import { Progress } from "@alloy/ui/components/progress"
import { cn } from "@alloy/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import {
  formatBytes,
  storageUsagePercent,
  storageUsageTone,
  type StorageUsageTone,
} from "@/lib/storage-format"
import { userKeys } from "@/lib/user-queries"

function useStorageUsage({
  refetchOnMount,
}: { refetchOnMount?: boolean | "always" } = {}) {
  return useQuery({
    queryKey: userKeys.storage(),
    queryFn: () => api.users.fetchStorageUsage(),
    staleTime: 30_000,
    refetchOnMount,
  })
}

function formatUsage(usedBytes: number, quotaBytes: number | null) {
  return quotaBytes === null
    ? tx("{used} used", { used: formatBytes(usedBytes) })
    : `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`
}

function quotaToneClasses(tone: StorageUsageTone) {
  switch (tone) {
    case "danger":
      return {
        indicator: "bg-danger",
        text: "text-danger",
      }
    case "warning":
      return {
        indicator: "bg-warning",
        text: "text-warning",
      }
    case "normal":
      return {
        indicator: undefined,
        text: undefined,
      }
  }
}

export function StorageQuota({ className }: { className?: string }) {
  const { data } = useStorageUsage()
  const usedBytes = data?.usedBytes ?? 0
  const quotaBytes = data?.quotaBytes ?? null
  const pct = storageUsagePercent(usedBytes, quotaBytes)
  const tone = quotaToneClasses(storageUsageTone(usedBytes, quotaBytes))

  return (
    <div className={cn("flex flex-col gap-3 py-4", className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{tx("Storage")}</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            {tx("Source clips count toward your quota. Encoded copies do not.")}
          </p>
        </div>
        <div
          className={cn(
            "shrink-0 text-right text-sm tabular-nums transition-colors",
            tone.text,
          )}
        >
          {formatUsage(usedBytes, quotaBytes)}
        </div>
      </div>
      <Progress value={pct} indicatorClassName={tone.indicator} />
    </div>
  )
}

export function StorageQuotaCompact({ className }: { className?: string }) {
  const { data } = useStorageUsage({ refetchOnMount: "always" })
  const usedBytes = data?.usedBytes ?? 0
  const quotaBytes = data?.quotaBytes ?? null
  const pct = storageUsagePercent(usedBytes, quotaBytes)
  const tone = quotaToneClasses(storageUsageTone(usedBytes, quotaBytes))

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground-muted text-xs font-medium">
          {tx("Storage")}
        </span>
        <span
          className={cn(
            "text-2xs text-foreground-faint tabular-nums transition-colors",
            tone.text,
          )}
        >
          {formatUsage(usedBytes, quotaBytes)}
        </span>
      </div>
      <Progress value={pct} indicatorClassName={tone.indicator} />
    </div>
  )
}
