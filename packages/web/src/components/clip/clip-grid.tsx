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
        // Match `TopClipsRow`: 1 card on mobile, 3 at md, 5 at 2xl.
        "grid grid-cols-1 gap-x-4 gap-y-6 md:grid-cols-3 2xl:grid-cols-5",
        "[&>*]:[contain-intrinsic-size:260px] [&>*]:[content-visibility:auto]",
      )}
      className={className}
      {...props}
    />
  )
}
