import { Skeleton } from "@alloy/ui/components/skeleton"
import { cn } from "@alloy/ui/lib/utils"

/**
 * Identity-bar skeleton shown inside the frosted card body while the profile
 * loads. The banner above is rendered by the card itself.
 */
export function ProfileIdentitySkeleton() {
  return (
    <div className="pt-4 pb-4 sm:pt-5">
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Avatar skeleton */}
        <Skeleton
          className={cn(
            "!size-16 shrink-0 rounded-full ring-2 ring-white/10",
            "sm:!size-24",
          )}
        />

        {/* Text skeletons */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-5 w-32 sm:h-7 sm:w-40" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-4 w-44" />
        </div>
      </div>
    </div>
  )
}
