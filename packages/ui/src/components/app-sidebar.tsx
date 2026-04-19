import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy AppSidebar — fixed-width icon-only rail.
 *
 * Always `--sidebar-rail` (52px) wide. No hover expansion.
 * Compose via `AppSidebarGroup` + `AppSidebarItem`, with an optional
 * `AppSidebarFooter`. Active items glow in Alloy's accent.
 */

function AppSidebar({ className, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      data-slot="app-sidebar"
      className={cn(
        "relative z-10 flex h-full flex-col overflow-hidden",
        "w-[var(--sidebar-rail)] border-r border-border bg-surface-sunken py-3",
        className
      )}
      {...props}
    />
  )
}

function AppSidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-sidebar-group"
      className={cn("flex flex-col gap-1 px-1.5 py-2 first:pt-0", className)}
      {...props}
    />
  )
}

/**
 * Single rail item. Defaults to `<button>` but accepts `render` so callers
 * can pass a router `<Link />` and get real navigation while keeping the
 * sidebar's icon-only rail styling + active-state glow.
 */
function AppSidebarItem({
  className,
  active,
  title,
  render,
  ...props
}: useRender.ComponentProps<"button"> & { active?: boolean }) {
  // `data-slot` + `data-active` get emitted by Base UI's default style-hook
  // mapping off the `state` object below (truthy keys → `data-<key>`). That
  // lets us keep mergeProps typed as plain button attrs — passing a literal
  // `"data-slot"` here would be rejected by React's button props type.
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: "button",
        title,
        className: cn(
          "group/app-sidebar-item relative flex h-[34px] w-full items-center justify-center rounded-md",
          "text-foreground-muted",
          "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          // Hover styles are gated on `not-data-active` so they don't clobber
          // the accent colours when the pointer is still over an item the
          // user just selected (hover → click → hover lingers; without the
          // gate the active item briefly flashes back to the muted hover bg).
          "not-data-active:hover:bg-surface-raised not-data-active:hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "data-active:bg-accent-soft data-active:text-accent",
          // active bar indicator
          "data-active:before:absolute data-active:before:top-1/2 data-active:before:-left-1.5",
          "data-active:before:h-4 data-active:before:w-[2px] data-active:before:-translate-y-1/2",
          "data-active:before:bg-accent data-active:before:shadow-[0_0_6px_var(--accent-glow)]",
          "data-active:before:content-['']",
          "[&_svg]:size-[18px] [&_svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "app-sidebar-item", active: active ?? false },
  })
}

function AppSidebarFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-sidebar-footer"
      className={cn(
        "mt-auto border-t border-border px-1.5 pt-2 pb-0",
        className
      )}
      {...props}
    />
  )
}

export { AppSidebar, AppSidebarGroup, AppSidebarItem, AppSidebarFooter }
