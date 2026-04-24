import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

function Section({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function SectionHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-header"
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border pb-4",
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
        "text-md leading-tight font-semibold tracking-[-0.005em]",
        className
      )}
      {...props}
    />
  )
}

function SectionContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-content"
      className={cn("py-4", className)}
      {...props}
    />
  )
}

function SectionFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-footer"
      className={cn(
        "flex items-center justify-end gap-2 border-t border-border pt-4",
        className
      )}
      {...props}
    />
  )
}

export { Section, SectionHeader, SectionTitle, SectionContent, SectionFooter }
