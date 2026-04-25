import { Spinner } from "@workspace/ui/components/spinner"

export function ProfileIdentitySkeleton() {
  return (
    <div className="flex min-h-48 items-center justify-center sm:min-h-64">
      <Spinner className="size-6" />
    </div>
  )
}
