import { Spinner } from "@workspace/ui/components/spinner"

import { APP_BANNER_HEIGHT_CLASS } from "@/lib/banner-layout"

export function GameHeaderSkeleton() {
  return (
    <div
      className={`${APP_BANNER_HEIGHT_CLASS} flex w-full items-center justify-center`}
    >
      <Spinner className="size-6" />
    </div>
  )
}
