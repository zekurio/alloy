import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva } from "class-variance-authority"
import { cn } from "@workspace/ui/lib/utils"
import type { VariantProps } from "class-variance-authority"

/**
 * Alloy Tabs — defaults to an underlined "line" variant with an accent
 * indicator that glows subtly on the active tab.
 *
 * Variants:
 *   line      — bottom-border tabs with glowing accent indicator (default)
 *   default   — shadcn-compatible segmented control
 */
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
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
  }
)

function TabsList({
  className,
  variant = "line",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "group/tabs-trigger relative inline-flex h-8 items-center gap-2 px-0.5",
        "text-sm font-medium whitespace-nowrap text-foreground-dim",
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
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

/** Badge-style count pill used inside a tab trigger. */
function TabsCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tabs-count"
      className={cn(
        "inline-flex items-center justify-center rounded-sm px-1.5 py-px",
        "bg-surface-raised font-mono text-2xs text-foreground-faint",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsCount, tabsListVariants }
