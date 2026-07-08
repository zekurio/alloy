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
 *
 * Sticky positioning and horizontal overflow live on SEPARATE elements:
 * a sticky element that is its own scroll container stops sticking in
 * WebKit (mobile Safari), so the outer div sticks and the inner row pans.
 *
 * With the default `rail`, controls never wrap or collapse: the row pans
 * horizontally when it overflows (scrollbar hidden), so every chip stays
 * visible at its natural width on narrow screens. Pass `rail={false}` when
 * a child manages its own horizontal overflow (e.g. a chip carousel).
 */
function PageToolbar({
  className,
  rail = true,
  children,
  ...props
}: ComponentProps<"div"> & { rail?: boolean }) {
  return (
    <div
      data-slot="page-toolbar"
      className={cn(
        "sticky top-0 z-10 -mx-4 mb-4 border-b border-border bg-background",
        "md:-mx-6 md:mb-6",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5 px-4 py-2 md:px-6",
          rail &&
            "no-scrollbar overflow-x-auto overflow-y-hidden [&>*]:shrink-0",
        )}
      >
        {children}
      </div>
    </div>
  )
}

export { PageToolbar }
