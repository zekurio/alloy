import { Progress } from "@alloy/ui/components/progress"
import { cn } from "@alloy/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { formatBytes, storageUsagePercent } from "@/lib/storage-format"
import { userKeys } from "@/lib/user-queries"

function useStorageUsage() {
  return useQuery({
    queryKey: userKeys.storage(),
    queryFn: () => api.users.fetchStorageUsage(),
    staleTime: 30_000,
  })
}

function formatUsage(usedBytes: number, quotaBytes: number | null) {
  return quotaBytes === null
    ? `${formatBytes(usedBytes)} used`
    : `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`
}

export function StorageQuota({ className }: { className?: string }) {
  const { data } = useStorageUsage()
  const usedBytes = data?.usedBytes ?? 0
  const quotaBytes = data?.quotaBytes ?? null
  const pct = storageUsagePercent(usedBytes, quotaBytes)

  return (
    <div className={cn("flex flex-col gap-3 py-4", className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Storage</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            Source clips count toward your quota. Encoded copies do not.
          </p>
        </div>
        <div className="shrink-0 text-right text-sm tabular-nums">
          {formatUsage(usedBytes, quotaBytes)}
        </div>
      </div>
      <Progress value={pct} />
    </div>
  )
}

export function StorageQuotaCompact({ className }: { className?: string }) {
  const { data } = useStorageUsage()
  const usedBytes = data?.usedBytes ?? 0
  const quotaBytes = data?.quotaBytes ?? null
  const pct = storageUsagePercent(usedBytes, quotaBytes)

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground-muted text-xs font-medium">
          Storage
        </span>
        <span className="text-2xs text-foreground-faint tabular-nums">
          {formatUsage(usedBytes, quotaBytes)}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  )
}
