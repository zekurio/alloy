"use client"

import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "inline-flex items-center gap-2 select-none",
        "text-sm leading-4 font-medium tracking-[-0.01em] text-foreground",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
