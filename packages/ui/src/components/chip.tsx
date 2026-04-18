import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {  cva } from "class-variance-authority"
import { cn } from "@workspace/ui/lib/utils"
import type {VariantProps} from "class-variance-authority";


/**
 * Alloy Chip — interactive filter pill. Different from `Badge` (which is
 * passive state):
 *   - 24px tall (vs. 18px for badges)
 *   - Mixed-case text (vs. badge's uppercase mono)
 *   - Clickable — pair with `data-active` for the toggled state
 *
 * Example:
 *   <Chip data-active="true">Today</Chip>
 *   <Chip>Week</Chip>
 */
const chipVariants = cva(
  cn(
    "inline-flex h-6 items-center gap-2 px-3",
    "rounded-md border border-border bg-surface-raised",
    "text-xs text-foreground-muted whitespace-nowrap cursor-pointer select-none",
    "transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:border-border-strong hover:text-foreground",
    "data-active:bg-accent-soft data-active:border-accent-border data-active:text-accent",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
  ),
  {
    variants: {
      size: {
        default: "h-6 px-3 text-xs",
        sm: "h-5 px-2.5 text-2xs",
        lg: "h-7 px-3.5 text-sm",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Chip({
  className,
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"button"> & VariantProps<typeof chipVariants>) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      { className: cn(chipVariants({ size }), className), type: "button" },
      props
    ),
    render,
    state: { slot: "chip", size },
  })
}

export { Chip, chipVariants }
