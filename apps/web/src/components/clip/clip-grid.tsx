import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

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
        "grid grid-cols-1 gap-6 md:grid-cols-3 xl:grid-cols-5",
        "[&>*]:[contain-intrinsic-size:260px] [&>*]:[content-visibility:auto]"
      )}
      className={className}
      {...props}
    />
  )
}

export function GameRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <GridFrame
      baseClassName={cn(
        "grid gap-4",
        "[grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]",
        "xl:[grid-template-columns:repeat(6,minmax(0,1fr))]"
      )}
      className={className}
      {...props}
    />
  )
}
