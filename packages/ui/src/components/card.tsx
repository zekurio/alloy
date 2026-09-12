import { cn } from "@alloy/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

const cardVariants = cva(
  "group/card flex flex-col overflow-hidden rounded-lg border text-foreground",
  {
    variants: {
      tone: {
        default: "border-border bg-surface-raised/40",
        surface: "border-border bg-surface/60",
        destructive: "border-destructive/40 bg-danger-soft",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
)

/** Bordered panel; use Section for groups without a border. */
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

export { Card }
