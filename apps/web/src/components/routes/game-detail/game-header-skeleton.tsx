import { Spinner } from "@workspace/ui/components/spinner"

export function GameHeaderSkeleton() {
  return (
    <div className="flex aspect-[16/4] max-h-[280px] min-h-32 w-full items-center justify-center sm:min-h-[160px]">
      <Spinner className="size-6" />
    </div>
  )
}
