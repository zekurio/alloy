import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

function GridFrame({
  className,
  baseClassName,
  ...props
}: React.ComponentProps<"div"> & { baseClassName: string }) {
  return <div className={cn(baseClassName, className)} {...props} />
}

export function ClipGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <GridFrame
      data-slot="clip-grid"
      baseClassName={cn(
        // Columns floor at 380px (the `TopClipsRow` deck slide width) and
        // stretch with `1fr` to fill the row, so there's no dead right gutter.
        "grid gap-x-4 gap-y-6 [grid-template-columns:repeat(auto-fill,minmax(min(380px,100%),1fr))]",
        "[&>*]:[contain-intrinsic-size:260px] [&>*]:[content-visibility:auto]",
      )}
      className={className}
      {...props}
    />
  )
}
