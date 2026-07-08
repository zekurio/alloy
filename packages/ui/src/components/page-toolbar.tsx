import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

/**
 * Route-owned control row (filter/sort chips) that a page renders inline,
 * directly above the content it affects — instead of the global `AppHeader`,
 * which stays the same shape on every route.
 *
 * Two placement modes:
 * - `pinned` — a plain row for the `AppMainColumn`/`AppMainScroll` layout:
 *   the page structure keeps it above the scroll region, so it never moves
 *   and needs no `position: sticky`. Prefer this; sticky positioning inside
 *   scroll containers is unreliable in mobile WebKit.
 * - default (sticky) — for pages with content above the toolbar (banners,
 *   profile headers): bleeds edge to edge via negative margin/padding pairs
 *   matched to the container's padding (`AppMain`'s `p-4 md:p-6` or a
 *   route's own `px-4 md:px-6` wrapper) and pins to the top of the nearest
 *   scrolling ancestor once the page scrolls past it. Treat the pinning as
 *   a progressive enhancement on iOS.
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
  pinned = false,
  children,
  ...props
}: ComponentProps<"div"> & { rail?: boolean; pinned?: boolean }) {
  return (
    <div
      data-slot="page-toolbar"
      className={cn(
        "border-b border-border bg-background",
        !pinned && "sticky top-0 z-10 -mx-4 mb-4 md:-mx-6 md:mb-6",
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
