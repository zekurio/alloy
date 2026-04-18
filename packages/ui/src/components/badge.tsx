import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {  cva } from "class-variance-authority"
import { cn } from "@workspace/ui/lib/utils"
import type {VariantProps} from "class-variance-authority";


/**
 * Alloy Badge — short monospaced pill used to label state.
 *
 * Variants:
 *   default  — neutral 100 + border
 *   accent   — soft blue fill, accent fg
 *   success  — green
 *   warning  — amber
 *   danger   — red
 *   live     — red with a pulsing dot (live recordings)
 *
 * shadcn aliases: `secondary` → default, `destructive` → danger, `outline` →
 * transparent outline (kept for parity with existing call-sites).
 */
const badgeVariants = cva(
  cn(
    "group/badge inline-flex items-center gap-1.5 h-[18px] px-2",
    "rounded-md border whitespace-nowrap overflow-hidden",
    "font-mono text-2xs font-medium uppercase tracking-[0.06em]",
    "transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    "[&>svg]:pointer-events-none [&>svg]:size-2.5"
  ),
  {
    variants: {
      variant: {
        default: "bg-surface-raised text-foreground-muted border-border",
        accent: "bg-accent-soft text-accent border-accent-border",
        success:
          "bg-[oklch(0.72_0.19_145/0.1)] text-success border-[oklch(0.72_0.19_145/0.35)]",
        warning:
          "bg-[oklch(0.82_0.18_90/0.1)] text-warning border-[oklch(0.82_0.18_90/0.35)]",
        danger:
          "bg-[oklch(0.65_0.24_25/0.12)] text-danger border-[oklch(0.65_0.24_25/0.4)]",
        live: cn(
          "bg-[oklch(0.65_0.25_25/0.12)] text-live border-[oklch(0.65_0.25_25/0.4)]",
          // pulsing dot — leading pseudo
          "before:content-[''] before:size-[5px] before:rounded-full before:bg-live",
          "before:shadow-[0_0_6px_var(--live)] before:animate-pulse-dot"
        ),
        // shadcn aliases
        secondary: "bg-surface-raised text-foreground-muted border-border",
        destructive:
          "bg-[oklch(0.65_0.24_25/0.12)] text-danger border-[oklch(0.65_0.24_25/0.4)]",
        outline: "bg-transparent text-foreground border-border-strong",
        ghost: "bg-transparent text-foreground-muted border-transparent",
        link: "bg-transparent text-accent border-transparent underline-offset-4 hover:underline",
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
