import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

/**
 * Sticky, route-owned control row (filter/sort chips) that a page renders
 * inline, directly above the content it affects — instead of the global
 * `AppHeader`, which stays the same shape on every route. Bleeds edge to
 * edge via matching negative margin/padding pairs, so it reads as a
 * continuous strip flush under the header regardless of which container's
 * padding it inherits (`AppMain`'s default `p-4 md:p-6`, or a route's own
 * `px-4 md:px-6` wrapper). Sticks to the top of the nearest scrolling
 * ancestor once the page scrolls past it.
 */
function PageToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="page-toolbar"
      className={cn(
        "sticky top-0 z-10 -mx-4 mb-4 flex min-w-0 flex-wrap items-center gap-1.5",
        "border-b border-border bg-background px-4 py-2",
        "md:-mx-6 md:mb-6 md:px-6",
        className,
      )}
      {...props}
    />
  )
}

export { PageToolbar }
