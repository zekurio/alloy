import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@workspace/ui/lib/utils"

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
        "focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:outline-none",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        // Override browser autofill chrome (yellow/blue bgs) with our theme tokens.
        // box-shadow inset is the only reliable way to paint over the forced autofill bg.
        "[&:-webkit-autofill]:[box-shadow:0_0_0_1000px_var(--input)_inset]",
        "[&:-webkit-autofill]:[-webkit-text-fill-color:var(--foreground)]",
        "[&:-webkit-autofill]:[caret-color:var(--foreground)]",
        "[&:-webkit-autofill:hover]:[box-shadow:0_0_0_1000px_var(--input)_inset]",
        "[&:-webkit-autofill:focus]:[box-shadow:0_0_0_1000px_var(--surface-raised)_inset]",
        "[&:-webkit-autofill:focus]:[-webkit-text-fill-color:var(--foreground)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
