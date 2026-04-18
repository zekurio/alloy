import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy Input — 30px, neutral-150 bg, sharpens to accent border on focus.
 *
 * Pair with `InputGroup` (input-group.tsx) for leading icons / trailing
 * keyboard hints.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "flex h-[30px] w-full min-w-0 items-center gap-2",
        "rounded-md border border-border bg-input px-3 text-sm text-foreground",
        "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "placeholder:text-foreground-faint",
        "hover:border-border-strong",
        "focus-visible:outline-none focus-visible:border-accent-border focus-visible:bg-surface-raised",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
