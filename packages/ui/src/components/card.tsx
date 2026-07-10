import { cn } from "@alloy/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

function CardSection({
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

const cardVariants = cva(
  "group/card flex flex-col overflow-hidden rounded-lg border text-foreground",
  {
    variants: {
      tone: {
        default: "border-border bg-surface-raised/40",
        surface: "border-border bg-surface/60",
        destructive: "border-destructive/40 bg-destructive/5",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
)

/**
 * Bordered container for discrete panels: stat blocks, settings toggles,
 * preview tiles, sidebar panes. Compose with {@link CardHeader},
 * {@link CardContent} (use `className="p-0"` for flush lists/grids), and
 * {@link CardFooter}. For plain in-page groupings without chrome, prefer
 * Section.
 */
function Card({
  className,
  tone = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-tone={tone}
      className={cn(cardVariants({ tone, className }))}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <CardSection
      slot="card-header"
      baseClassName="flex items-start justify-between gap-3 border-b border-border px-4 py-3"
      className={className}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <CardSection
      slot="card-title"
      baseClassName="text-sm leading-tight font-semibold"
      className={className}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <CardSection
      slot="card-description"
      baseClassName="text-foreground-dim text-xs"
      className={className}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <CardSection
      slot="card-content"
      baseClassName="p-4"
      className={className}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <CardSection
      slot="card-footer"
      baseClassName="flex items-center justify-end gap-2 border-t border-border px-4 py-3"
      className={className}
      {...props}
    />
  )
}

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
}
