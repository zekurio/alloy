import { cn } from "@workspace/ui/lib/utils"
import { Skeleton } from "@workspace/ui/components/skeleton"

export function ProfileIdentitySkeleton() {
  return (
    <>
      <div className="flex w-full flex-col">
        <section
          className={cn(
            "relative -mx-4 -mt-6 overflow-hidden md:-mx-8",
            "aspect-[3/1] max-h-[320px] min-h-28 sm:min-h-[180px]"
          )}
        >
          <Skeleton className="absolute inset-0 size-full rounded-none" />
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-3 sm:gap-4 sm:p-6">
            <Skeleton className="size-16 shrink-0 rounded-lg sm:size-24" />
            <div className="flex flex-col gap-2 pb-1">
              <Skeleton className="h-6 w-40 sm:h-7 sm:w-48" />
              <Skeleton className="h-3 w-36" />
            </div>
          </div>
        </section>
      </div>
      <div className="mt-3 mb-3 sm:mt-4 sm:mb-8">
        <Skeleton className="h-4 w-64" />
      </div>
    </>
  )
}
