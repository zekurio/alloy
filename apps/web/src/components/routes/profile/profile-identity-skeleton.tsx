import { Skeleton } from "@workspace/ui/components/skeleton"

export function ProfileIdentitySkeleton() {
  return (
    <section className="mb-8">
      <Skeleton className="h-32 w-full rounded-lg sm:h-40" />
      <div className="-mt-10 flex items-end gap-5 px-1 sm:-mt-12">
        <Skeleton className="size-24 rounded-lg" />
        <div className="flex flex-col gap-2 pb-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
    </section>
  )
}
