import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-lg border border-border bg-input px-3.5 py-3 text-base leading-relaxed transition-[border-color,background-color,box-shadow] outline-none placeholder:text-muted-foreground hover:border-border-strong hover:bg-surface-raised focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent-border/20 focus-visible:ring-inset disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:bg-destructive/5 aria-invalid:ring-2 aria-invalid:ring-destructive/15 aria-invalid:ring-inset user-invalid:border-destructive user-invalid:bg-destructive/5 user-invalid:ring-2 user-invalid:ring-destructive/15 user-invalid:ring-inset",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
