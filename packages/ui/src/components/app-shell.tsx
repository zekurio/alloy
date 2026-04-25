import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

function AppShell({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        "relative grid h-dvh w-full overflow-hidden bg-background",
        // Mobile: single column with bottom nav row (safe-area aware).
        "[grid-template-columns:1fr]",
        "[grid-template-rows:var(--header-h)_1fr_calc(var(--bottomnav-h)_+_env(safe-area-inset-bottom,0px))]",
        "[grid-template-areas:'header''main''bottomnav']",
        // Desktop (md+): classic sidebar rail + main, header spans both.
        "md:[grid-template-columns:var(--sidebar-rail)_1fr]",
        "md:[grid-template-rows:var(--header-h)_1fr]",
        "md:[grid-template-areas:'header_header''sidebar_main']",
        "[&_[data-slot=app-sidebar]]:[grid-area:sidebar]",
        "[&_[data-slot=app-bottom-nav]]:[grid-area:bottomnav]",
        "[&_[data-slot=app-header]]:[grid-area:header]",
        "[&_[data-slot=app-main]]:[grid-area:main]",
        className
      )}
      {...props}
    />
  )
}

/**
 * Main content region. Scrolls vertically; responsive side padding
 * (16px mobile → 32px desktop).
 */
function AppMain({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="app-main"
      className={cn(
        "overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] px-4 py-4 md:px-8 md:py-6",
        className
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

export { AppShell, AppMain, DividerV }
