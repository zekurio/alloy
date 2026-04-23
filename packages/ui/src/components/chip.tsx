import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva } from "class-variance-authority"
import { cn } from "@workspace/ui/lib/utils"
import type { VariantProps } from "class-variance-authority"

const chipVariants = cva(
  cn(
    "inline-flex items-center gap-2 leading-none",
    "rounded-md border border-border bg-surface-raised",
    "cursor-pointer whitespace-nowrap text-foreground-muted select-none",
    "transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:border-border-strong hover:text-foreground",
    "data-active:border-accent-border data-active:bg-accent-soft data-active:text-accent",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0"
  ),
  {
    variants: {
      size: {
        default: "h-6 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-5 px-2 text-2xs [&_svg:not([class*='size-'])]:size-3",
        lg: "h-7 px-3 text-sm [&_svg:not([class*='size-'])]:size-4",
        xl: "h-8 rounded-lg px-2.5 text-sm font-semibold [&_svg:not([class*='size-'])]:size-4",
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
