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
        // Fixed 340px columns matched to the `TopClipsRow` deck slide width.
        "grid gap-x-4 gap-y-6 [grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),340px))]",
        "[&>*]:[contain-intrinsic-size:260px] [&>*]:[content-visibility:auto]",
      )}
      className={className}
      {...props}
    />
  )
}
