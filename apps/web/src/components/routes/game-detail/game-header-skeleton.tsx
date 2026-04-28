import { Spinner } from "@workspace/ui/components/spinner"

export function GameHeaderSkeleton() {
  return (
    <div className="flex h-[clamp(260px,28vw,480px)] w-full items-center justify-center">
      <Spinner className="size-6" />
    </div>
  )
}
