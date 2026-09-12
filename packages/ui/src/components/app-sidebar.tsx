import { cn } from "@alloy/ui/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import type { ComponentProps, ReactNode } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

function AppSidebar({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      data-slot="app-sidebar"
      className={cn(
        "relative z-10 flex h-full flex-col overflow-hidden",
        // The 4px top inset centers the first item on the 48px page toolbar.
        "w-[var(--sidebar-rail)] border-r border-border bg-surface-sunken py-1",
        className,
      )}
      {...props}
    />
  )
}

function AppSidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="app-sidebar-group"
      className={cn("flex flex-col items-center gap-1 px-1.5", className)}
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
  { className, active, title, render, ...props }: NavItemProps,
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
      props,
    ),
    render,
    state: { slot: style.slot, active: active ?? false },
  })
}

const SIDEBAR_ITEM_STYLE: NavItemStyle = {
  slot: "app-sidebar-item",
  className: cn(
    "group/app-sidebar-item relative flex size-10 shrink-0 items-center justify-center rounded-md",
    "text-foreground-muted",
    "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "not-data-active:hover:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    "data-active:text-accent",
    // The 5px offset clears the rail's right inset while staying inside its
    // 1px border, where overflow-hidden will not clip the indicator.
    "data-active:before:absolute data-active:before:top-1/2 data-active:before:-right-[5px]",
    "data-active:before:h-4 data-active:before:w-[2px] data-active:before:-translate-y-1/2",
    "data-active:before:bg-accent data-active:before:shadow-[0_0_6px_var(--accent-glow)]",
    "data-active:before:content-['']",
    "[&_svg]:size-6 [&_svg]:shrink-0",
  ),
}

function AppSidebarItem(props: NavItemProps) {
  return useNavItem(SIDEBAR_ITEM_STYLE, props)
}

function AppSidebarItemTooltip({
  label,
  render,
  ...props
}: Omit<ComponentProps<typeof TooltipContent>, "children" | "side"> & {
  label: ReactNode
  render: ComponentProps<typeof TooltipTrigger>["render"]
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={render} />
      <TooltipContent side="right" {...props}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export { AppSidebar, AppSidebarGroup, AppSidebarItem, AppSidebarItemTooltip }
