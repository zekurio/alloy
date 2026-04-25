import { Spinner } from "@workspace/ui/components/spinner"

export function ClipCardSkeleton() {
  return (
    <div className="flex aspect-video items-center justify-center">
      <Spinner className="size-5" />
    </div>
  )
}
