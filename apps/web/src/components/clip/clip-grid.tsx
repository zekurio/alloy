import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export function ClipGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="clip-grid"
      className={cn(
        "grid gap-6",
        "[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]",
        "xl:[grid-template-columns:repeat(5,minmax(0,1fr))]",
        "[&>*]:[contain-intrinsic-size:260px] [&>*]:[content-visibility:auto]",
        className
      )}
      {...props}
    />
  )
}

export function GameRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid gap-4",
        "[grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]",
        "xl:[grid-template-columns:repeat(6,minmax(0,1fr))]",
        className
      )}
      {...props}
    />
  )
}
