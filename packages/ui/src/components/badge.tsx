import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva } from "class-variance-authority"
import { cn } from "@workspace/ui/lib/utils"
import type { VariantProps } from "class-variance-authority"

const badgeVariants = cva(
  cn(
    "group/badge inline-flex h-[18px] items-center gap-1.5 px-2",
    "overflow-hidden rounded-md border whitespace-nowrap",
    "font-mono text-2xs font-medium tracking-[0.06em] uppercase",
    "transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none",
    "[&>svg]:pointer-events-none [&>svg]:size-2.5"
  ),
  {
    variants: {
      variant: {
        default: "border-border bg-surface-raised text-foreground-muted",
        accent: "border-accent-border bg-accent-soft text-accent",
        success:
          "border-[oklch(0.72_0.19_145/0.35)] bg-[oklch(0.72_0.19_145/0.1)] text-success",
        warning:
          "border-[oklch(0.82_0.18_90/0.35)] bg-[oklch(0.82_0.18_90/0.1)] text-warning",
        danger:
          "border-[oklch(0.65_0.24_25/0.4)] bg-[oklch(0.65_0.24_25/0.12)] text-danger",
        live: cn(
          "border-[oklch(0.65_0.25_25/0.4)] bg-[oklch(0.65_0.25_25/0.12)] text-live",
          // pulsing dot — leading pseudo
          "before:size-[5px] before:rounded-full before:bg-live before:content-['']",
          "before:animate-pulse-dot before:shadow-[0_0_6px_var(--live)]"
        ),
        // shadcn aliases
        secondary: "border-border bg-surface-raised text-foreground-muted",
        destructive:
          "border-[oklch(0.65_0.24_25/0.4)] bg-[oklch(0.65_0.24_25/0.12)] text-danger",
        outline: "border-border-strong bg-transparent text-foreground",
        ghost: "border-transparent bg-transparent text-foreground-muted",
        link: "border-transparent bg-transparent text-accent underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      { className: cn(badgeVariants({ variant }), className) },
      props
    ),
    render,
    state: { slot: "badge", variant },
  })
}

export { Badge, badgeVariants }
