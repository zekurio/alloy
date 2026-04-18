"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy Label — monospaced, uppercase "eyebrow" style used above every input.
 * Matches the `.label` rule in components.css.
 *
 * Example:
 *   <Label htmlFor="name">Display Name</Label>
 *   <Input id="name" defaultValue="shroud_v2" />
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "inline-flex items-center gap-2 select-none",
        "font-mono text-2xs uppercase tracking-[0.1em] text-foreground-dim",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
