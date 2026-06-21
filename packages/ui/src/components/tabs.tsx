import { cn } from "@alloy/ui/lib/utils"
import { Tabs } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

function TabsRoot({
  className,
  orientation = "horizontal",
  ...props
}: Tabs.Root.Props) {
  return (
    <Tabs.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className,
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-full items-center text-muted-foreground",
  {
    variants: {
      variant: {
        line: "gap-5 border-b border-border",
        default: "h-8 w-fit justify-center rounded-md bg-muted p-[3px]",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  },
)

function TabsList({
  className,
  variant = "line",
  ...props
}: Tabs.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <Tabs.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: Tabs.Tab.Props) {
  return (
    <Tabs.Tab
      data-slot="tabs-trigger"
      className={cn(
        "group/tabs-trigger relative inline-flex h-8 items-center gap-2 px-0.5",
        "text-sm font-semibold whitespace-nowrap text-foreground-muted",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "outline-none focus-visible:text-foreground",
        "hover:text-foreground",
        "data-active:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        // Accent underline — only on `line` list variant
        "in-data-[variant=line]:after:absolute in-data-[variant=line]:after:right-0 in-data-[variant=line]:after:-bottom-px in-data-[variant=line]:after:left-0 in-data-[variant=line]:after:h-px in-data-[variant=line]:after:content-['']",
        "in-data-[variant=line]:after:bg-accent in-data-[variant=line]:after:opacity-0",
        "in-data-[variant=line]:after:shadow-[0_0_8px_var(--accent-glow)]",
        "in-data-[variant=line]:data-active:after:opacity-100",
        // Segmented (default) variant
        "in-data-[variant=default]:h-[calc(100%-1px)] in-data-[variant=default]:flex-1 in-data-[variant=default]:justify-center in-data-[variant=default]:rounded-md in-data-[variant=default]:px-1.5 in-data-[variant=default]:py-0.5",
        "in-data-[variant=default]:data-active:bg-background in-data-[variant=default]:data-active:shadow-sm",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: Tabs.Panel.Props) {
  return (
    <Tabs.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

/** Badge-style count pill used inside a tab trigger. */
function TabsCount({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="tabs-count"
      className={cn(
        "inline-flex items-center justify-center rounded-sm px-1.5 py-px",
        "bg-surface-raised text-2xs font-semibold text-foreground-muted",
        className,
      )}
      {...props}
    />
  )
}

export {
  TabsRoot as Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  tabsListVariants,
  TabsTrigger,
}
