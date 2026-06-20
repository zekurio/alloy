import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

function AppShell({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        "relative grid h-dvh w-full overflow-hidden bg-background",
        // Mobile: single column; navigation lives in a swipe drawer.
        "[grid-template-columns:1fr]",
        "[grid-template-rows:var(--header-h)_1fr]",
        "[grid-template-areas:'header''main']",
        // Desktop (md+): classic sidebar rail + main, header spans both.
        "md:[grid-template-columns:var(--sidebar-expanded)_1fr]",
        "md:[grid-template-rows:var(--header-h)_1fr]",
        "md:[grid-template-areas:'header_header''sidebar_main']",
        "[&_[data-slot=app-sidebar]]:[grid-area:sidebar]",
        "[&_[data-slot=app-header]]:[grid-area:header]",
        "[&_[data-slot=app-main]]:[grid-area:main]",
        className,
      )}
      {...props}
    />
  )
}

/**
 * Main content region. Scrolls vertically; responsive side padding
 * (16px mobile -> 24px desktop) stays even on every side.
 */
function AppMain({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="app-main"
      className={cn(
        "overflow-x-hidden overflow-y-auto p-4 md:p-6",
        // Clear the fixed mobile bottom-nav (hidden on md+) so the last row of
        // content isn't trapped behind it.
        "max-md:pb-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+1rem)]",
        className,
      )}
      {...props}
    />
  )
}

/**
 * 1px vertical divider — the little rule that separates header groups.
 * Pass `h={20}` or override via `className` (e.g. `h-5`).
 */
function DividerV({
  className,
  h = 20,
  style,
  ...props
}: React.ComponentProps<"span"> & { h?: number }) {
  return (
    <span
      aria-hidden
      data-slot="divider-v"
      className={cn("inline-block w-px shrink-0 bg-border", className)}
      style={{ height: h, ...style }}
      {...props}
    />
  )
}

export { AppMain, AppShell, DividerV }
