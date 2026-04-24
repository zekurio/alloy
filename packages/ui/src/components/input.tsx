import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@workspace/ui/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2",
        "rounded-lg border border-border bg-input px-3 text-sm text-foreground",
        "appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        "[&[type=number]]:[-moz-appearance:textfield]",
        "transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "placeholder:text-foreground-faint",
        "hover:border-border-strong hover:bg-surface-raised",
        "focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent-border/20 focus-visible:ring-inset",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:bg-destructive/5 aria-invalid:ring-2 aria-invalid:ring-destructive/15",
        "user-invalid:border-destructive user-invalid:bg-destructive/5 user-invalid:ring-2 user-invalid:ring-destructive/15",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        // Override browser autofill chrome (yellow/blue bgs) with our theme tokens.
        // box-shadow inset is the only reliable way to paint over the forced autofill bg.
        "[&:-webkit-autofill]:[box-shadow:0_0_0_1000px_var(--input)_inset]",
        "[&:-webkit-autofill]:[-webkit-text-fill-color:var(--foreground)]",
        "[&:-webkit-autofill]:[caret-color:var(--foreground)]",
        "[&:-webkit-autofill:hover]:[box-shadow:0_0_0_1000px_var(--surface-raised)_inset]",
        "[&:-webkit-autofill:focus]:[box-shadow:0_0_0_1000px_var(--surface-raised)_inset]",
        "[&:-webkit-autofill:focus]:[-webkit-text-fill-color:var(--foreground)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
