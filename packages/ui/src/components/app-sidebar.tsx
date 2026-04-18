import * as React from "react"

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

function AppSidebarItem({
  className,
  active,
  title,
  children,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="app-sidebar-item"
      data-active={active ? "true" : undefined}
      title={title}
      className={cn(
        "group/app-sidebar-item relative flex h-[34px] w-full items-center justify-center rounded-md",
        "text-foreground-muted",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-raised hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "data-active:bg-accent-soft data-active:text-accent",
        // active bar indicator
        "data-active:before:absolute data-active:before:-left-1.5 data-active:before:top-1/2",
        "data-active:before:-translate-y-1/2 data-active:before:h-4 data-active:before:w-[2px]",
        "data-active:before:bg-accent data-active:before:shadow-[0_0_6px_var(--accent-glow)]",
        "data-active:before:content-['']",
        "[&_svg]:size-[18px] [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
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

export {
  AppSidebar,
  AppSidebarGroup,
  AppSidebarItem,
  AppSidebarFooter,
}
