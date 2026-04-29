import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"

export function ProfileIdentitySkeleton() {
  return (
    <div className="flex w-full flex-col">
      {/* Banner skeleton */}
      <div
        className={cn(APP_BANNER_HEIGHT_CLASS, "w-full bg-surface-raised")}
      />

      {/* Profile info bar skeleton */}
      <div className="px-4 pb-3 sm:pb-4 md:px-8">
        <div className="flex items-start gap-3 sm:gap-4">
          {/* Avatar skeleton */}
          <Skeleton
            className={cn(
              "!size-16 shrink-0 rounded-full ring-[3px] ring-background",
              "sm:!size-24 sm:ring-4",
              "-mt-8 sm:-mt-12"
            )}
          />

          {/* Text skeletons */}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-2 sm:pt-2.5">
            <div className="flex items-baseline gap-2">
              <Skeleton className="h-5 w-32 sm:h-7 sm:w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-4 w-44" />
          </div>
        </div>
      </div>
    </div>
  )
}
