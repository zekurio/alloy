import { fieldControlClassName } from "@alloy/ui/lib/field-control"
import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldControlClassName,
        "flex field-sizing-content min-h-24 w-full px-3.5 py-3 text-base leading-relaxed placeholder:text-muted-foreground disabled:bg-input/50",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
