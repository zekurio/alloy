import { cn } from "@alloy/ui/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

const badgeVariants = cva(
  cn(
    "group/badge inline-flex h-5 items-center gap-1.5 px-2",
    "overflow-hidden rounded-md border whitespace-nowrap",
    "font-medium",
    "transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none",
    "[&>svg]:pointer-events-none [&>svg]:size-2.5",
  ),
  {
    variants: {
      variant: {
        default: "border-border bg-surface-raised text-foreground-muted",
        accent: "border-accent-border bg-accent-soft text-accent",
        danger: "border-danger/40 bg-danger-soft text-danger",
      },
      size: {
        // Plain-text badge for real words ("You", "Disabled", queue names).
        text: "font-sans text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "text",
    },
  },
)

function Badge({
  className,
  variant = "default",
  size = "text",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      { className: cn(badgeVariants({ variant, size }), className) },
      props,
    ),
    render,
    state: { slot: "badge", variant, size },
  })
}

function NumberBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "bg-surface-raised text-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background px-1 text-xs font-semibold leading-none tabular-nums",
        className,
      )}
      {...props}
    />
  )
}

export { Badge, NumberBadge }
