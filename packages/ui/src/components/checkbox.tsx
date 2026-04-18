"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy Checkbox — 14×14, accent-filled when checked. Uses a CSS-only tick
 * (no SVG) to match the handwritten components.css exactly.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative inline-flex size-3.5 shrink-0 items-center justify-center",
        "rounded-sm border border-border-strong bg-input",
        "transition-all duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        "data-checked:border-accent data-checked:bg-accent",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className={cn(
          "block size-2 rotate-[-45deg] translate-x-[0.5px] translate-y-[-1px]",
          "border-b-[1.5px] border-l-[1.5px] border-accent-foreground"
        )}
      />
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
