import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"

/**
 * Centered spinner block for section/page loading states. Override the
 * vertical padding via `className` (e.g. "py-16") where a section needs more
 * breathing room.
 */
export function LoadingState({
  className,
  spinnerClassName,
}: {
  className?: string
  spinnerClassName?: string
}) {
  return (
    <div
      role="status"
      className={cn("flex items-center justify-center py-12", className)}
    >
      <Spinner className={cn("size-6", spinnerClassName)} />
    </div>
  )
}
