import { cn } from "@alloy/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

function StatSection({
  slot,
  baseClassName,
  className,
  ...props
}: ComponentProps<"div"> & {
  slot: string
  baseClassName: string
}) {
  return (
    <div data-slot={slot} className={cn(baseClassName, className)} {...props} />
  )
}

const statGroupVariants = cva("grid", {
  variants: {
    variant: {
      // Boxy strip with dividers — pairs with <CardContent className="p-0">
      // for a flush stat card; pads each Stat tile.
      divided:
        "divide-y divide-border sm:divide-x sm:divide-y-0 [&>[data-slot=stat]]:px-4 [&>[data-slot=stat]]:py-3",
      // Minimal: no chrome, just the columns.
      plain: "gap-4 sm:gap-6",
    },
    cols: {
      2: "sm:grid-cols-2",
      3: "sm:grid-cols-3",
      4: "sm:grid-cols-4",
    },
  },
  defaultVariants: {
    variant: "plain",
    cols: 3,
  },
})

/**
 * Responsive strip of {@link Stat} tiles — stacked on mobile, equal-height
 * columns at sm+. Defaults to the minimal `plain` variant; use
 * `variant="divided"` inside a Card for the boxed look.
 */
function StatGroup({
  className,
  variant = "plain",
  cols = 3,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof statGroupVariants>) {
  return (
    <div
      data-slot="stat-group"
      data-variant={variant}
      className={cn(statGroupVariants({ variant, cols, className }))}
      {...props}
    />
  )
}

function Stat({ className, ...props }: ComponentProps<"div">) {
  return (
    <StatSection
      slot="stat"
      baseClassName="flex min-w-0 flex-col gap-0.5"
      className={className}
      {...props}
    />
  )
}

function StatLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <StatSection
      slot="stat-label"
      baseClassName="text-xs font-medium text-foreground"
      className={className}
      {...props}
    />
  )
}

const statValueVariants = cva("truncate text-sm font-semibold", {
  variants: {
    tone: {
      default: "text-foreground",
      warning: "text-warning",
      danger: "text-danger",
      accent: "text-accent",
    },
  },
  defaultVariants: {
    tone: "default",
  },
})

function StatValue({
  className,
  tone = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof statValueVariants>) {
  return (
    <div
      data-slot="stat-value"
      data-tone={tone}
      className={cn(statValueVariants({ tone, className }))}
      {...props}
    />
  )
}

function StatDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <StatSection
      slot="stat-description"
      baseClassName="text-foreground-dim truncate text-xs"
      className={className}
      {...props}
    />
  )
}

function StatCaption({ className, ...props }: ComponentProps<"div">) {
  return (
    <StatSection
      slot="stat-caption"
      baseClassName="text-foreground-muted text-xs"
      className={className}
      {...props}
    />
  )
}

export {
  Stat,
  StatCaption,
  StatDescription,
  StatGroup,
  StatLabel,
  StatValue,
  statGroupVariants,
  statValueVariants,
}
