import { Skeleton } from "@alloy/ui/components/skeleton"
import { cn } from "@alloy/ui/lib/utils"

/**
 * Identity-bar skeleton shown inside the frosted card body while the game
 * loads. Mirrors the no-banner layout (icon inline, centered with the text).
 */
export function GameIdentitySkeleton() {
  return (
    <div className="pt-4 pb-4 sm:pt-5">
      <div className="flex items-center gap-3 sm:gap-4">
        <Skeleton
          className={cn("!size-16 shrink-0 rounded-2xl", "sm:!size-24")}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-6 w-40 sm:h-8 sm:w-56" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </div>
  )
}
