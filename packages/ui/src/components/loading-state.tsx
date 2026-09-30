import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"

/**
 * Centered spinner block for section/page loading states. Override the
 * vertical padding via `className` (e.g. "py-16") where a section needs more
 * breathing room. Use the panel variant for both lazy-panel and initial-data
 * loading so the spinner stays in the same position between them.
 */
export function LoadingState({
  variant = "section",
  className,
  spinnerClassName,
}: {
  variant?: "section" | "panel"
  className?: string
  spinnerClassName?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center",
        variant === "panel" ? "text-foreground-muted h-32" : "py-12",
        className,
      )}
    >
      <Spinner
        className={cn(
          variant === "panel" ? "size-4" : "size-6",
          spinnerClassName,
        )}
      />
    </div>
  )
}
