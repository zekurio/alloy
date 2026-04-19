import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy AppShell — the top-level app layout. Two-column / two-row grid:
 *
 *   ┌──────────────────────────┐
 *   │          header          │
 *   ├────────┬─────────────────┤
 *   │sidebar │      main       │
 *   └────────┴─────────────────┘
 *
 * Children are placed by `data-slot` — drop in `AppSidebar`, `AppHeader`,
 * and `AppMain` in any order and they land in the right cell.
 *
 * Defaults to filling the viewport (`h-dvh`). Override `className` with
 * a fixed height (e.g. `h-[680px] border rounded-lg`) for a demo embed.
 */
function AppShell({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        "relative grid h-dvh w-full overflow-hidden bg-background",
        "[grid-template-columns:var(--sidebar-rail)_1fr]",
        "[grid-template-rows:var(--header-h)_1fr]",
        "[grid-template-areas:'header_header''sidebar_main']",
        "[&_[data-slot=app-sidebar]]:[grid-area:sidebar]",
        "[&_[data-slot=app-header]]:[grid-area:header]",
        "[&_[data-slot=app-main]]:[grid-area:main]",
        className
      )}
      {...props}
    />
  )
}

/**
 * Main content region. Scrolls vertically; generous side padding matches
 * the handoff (`--space-9` / 32px).
 */
function AppMain({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="app-main"
      className={cn(
        "overflow-y-auto overflow-x-hidden px-8 py-6",
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
