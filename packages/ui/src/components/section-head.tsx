import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

function SectionHead({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-head"
      className={cn("mb-4 flex items-center justify-between gap-4", className)}
      {...props}
    />
  )
}

function SectionEyebrow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-eyebrow"
      className={cn(
        "mb-1 font-mono text-2xs tracking-[0.12em] text-foreground-faint uppercase",
        className
      )}
      {...props}
    />
  )
}

function SectionTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-title"
      className={cn(
        "flex items-center gap-2 text-xl leading-7 font-semibold tracking-[-0.02em] text-foreground",
        "[&_svg]:size-5 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function SectionSub({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-sub"
      className={cn("text-xs text-foreground-dim", className)}
      {...props}
    />
  )
}

function SectionActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-actions"
      className={cn("flex items-center gap-1.5 leading-4", className)}
      {...props}
    />
  )
}

function SectionMeta({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="section-meta"
      className={cn(
        "text-xs font-semibold text-foreground-muted tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export {
  SectionHead,
  SectionEyebrow,
  SectionTitle,
  SectionSub,
  SectionActions,
  SectionMeta,
}
