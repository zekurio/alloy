import * as React from "react"

import { ChevronDownIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-fit has-[select:disabled]:opacity-50",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="h-10 w-full min-w-0 appearance-none rounded-lg border border-border bg-input py-2 pr-10 pl-3.5 text-base transition-[border-color,background-color,box-shadow] outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground hover:border-border-strong hover:bg-surface-raised focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent-border/20 focus-visible:ring-inset disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:bg-destructive/5 aria-invalid:ring-2 aria-invalid:ring-destructive/15 aria-invalid:ring-inset user-invalid:border-destructive user-invalid:bg-destructive/5 user-invalid:ring-2 user-invalid:ring-destructive/15 user-invalid:ring-inset data-[size=sm]:h-8 data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[size=sm]:py-1 data-[size=sm]:text-sm"
        {...props}
      />
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
