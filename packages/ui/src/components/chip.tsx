import { cn } from "@alloy/ui/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

const chipClassName = cn(
  "inline-flex h-8 items-center justify-center gap-2 px-2.5 text-center align-middle",
  "rounded-lg border border-border bg-surface-raised",
  "cursor-pointer text-sm leading-4 font-semibold whitespace-nowrap text-foreground-muted select-none",
  "transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
  "hover:border-border-strong hover:text-foreground",
  "data-active:border-accent-border data-active:bg-accent-soft data-active:text-accent",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
  "disabled:pointer-events-none disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
)

function Chip({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      { className: cn(chipClassName, className), type: "button" },
      props,
    ),
    render,
    state: { slot: "chip" },
  })
}

export { Chip }
