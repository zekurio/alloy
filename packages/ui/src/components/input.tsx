import { fieldControlClassName } from "@alloy/ui/lib/field-control"
import { cn } from "@alloy/ui/lib/utils"
import { Input } from "@base-ui/react/input"
import type { ComponentProps } from "react"

function InputRoot({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <Input
      type={type}
      data-slot="input"
      className={cn(
        fieldControlClassName,
        "flex h-9 w-full min-w-0 items-center gap-2 px-3 text-base sm:h-8 sm:text-sm",
        "appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        "[&[type=number]]:[-moz-appearance:textfield]",
        "placeholder:text-foreground-faint",
        "disabled:pointer-events-none",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        // Override browser autofill chrome (yellow/blue bgs) with our theme tokens.
        // box-shadow inset is the only reliable way to paint over the forced autofill bg.
        "[&:-webkit-autofill]:[box-shadow:0_0_0_1000px_var(--input)_inset]",
        "[&:-webkit-autofill]:[-webkit-text-fill-color:var(--foreground)]",
        "[&:-webkit-autofill]:[caret-color:var(--foreground)]",
        "[&:-webkit-autofill:hover]:[box-shadow:0_0_0_1000px_var(--surface-raised)_inset]",
        "[&:-webkit-autofill:focus]:[box-shadow:0_0_0_1000px_var(--surface-raised)_inset]",
        "[&:-webkit-autofill:focus]:[-webkit-text-fill-color:var(--foreground)]",
        className,
      )}
      {...props}
    />
  )
}

export { InputRoot as Input }
