import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@workspace/ui/lib/utils"

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

interface NavItemStyle {
  slot: string
  className: string
}

type NavItemProps = useRender.ComponentProps<"button"> & { active?: boolean }

function useNavItem(
  style: NavItemStyle,
  { className, active, title, render, ...props }: NavItemProps
) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: "button",
        title,
        "aria-label": title,
        className: cn(style.className, className),
      },
      props
    ),
    render,
    state: { slot: style.slot, active: active ?? false },
  })
}

const SIDEBAR_ITEM_STYLE: NavItemStyle = {
  slot: "app-sidebar-item",
  className: cn(
    "group/app-sidebar-item relative flex h-[34px] w-full items-center justify-center rounded-md",
    "text-foreground-muted",
    "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "not-data-active:hover:bg-surface-raised not-data-active:hover:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    "data-active:bg-accent-soft data-active:text-accent",
    // active bar indicator
    "data-active:before:absolute data-active:before:top-1/2 data-active:before:-left-1.5",
    "data-active:before:h-4 data-active:before:w-[2px] data-active:before:-translate-y-1/2",
    "data-active:before:bg-accent data-active:before:shadow-[0_0_6px_var(--accent-glow)]",
    "data-active:before:content-['']",
    "[&_svg]:size-[18px] [&_svg]:shrink-0"
  ),
}

const BOTTOM_NAV_ITEM_STYLE: NavItemStyle = {
  slot: "app-bottom-nav-item",
  className: cn(
    "group/app-bottom-nav-item relative flex flex-1 items-center justify-center",
    "min-h-[48px] rounded-md text-foreground-muted",
    "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "not-data-active:hover:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    "data-active:text-accent",
    // Active dot indicator at the top of the item.
    "data-active:before:absolute data-active:before:top-1 data-active:before:left-1/2",
    "data-active:before:h-[3px] data-active:before:w-6 data-active:before:-translate-x-1/2",
    "data-active:before:rounded-full data-active:before:bg-accent",
    "data-active:before:shadow-[0_0_8px_var(--accent-glow)]",
    "data-active:before:content-['']",
    "[&_svg]:size-6 [&_svg]:shrink-0"
  ),
}

function AppSidebarItem(props: NavItemProps) {
  return useNavItem(SIDEBAR_ITEM_STYLE, props)
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

function AppBottomNav({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="app-bottom-nav"
      className={cn(
        "relative z-10 flex items-stretch justify-around gap-1",
        "h-full border-t border-border bg-surface-sunken",
        "px-2 pb-[env(safe-area-inset-bottom,0px)]",
        className
      )}
      {...props}
    />
  )
}

function AppBottomNavItem(props: NavItemProps) {
  return useNavItem(BOTTOM_NAV_ITEM_STYLE, props)
}

export {
  AppSidebar,
  AppSidebarGroup,
  AppSidebarItem,
  AppSidebarFooter,
  AppBottomNav,
  AppBottomNavItem,
}
