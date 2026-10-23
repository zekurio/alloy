import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

function Section({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="section"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function SectionHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="section-header"
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border pb-4",
        className,
      )}
      {...props}
    />
  )
}

function SectionTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="section-title"
      className={cn(
        "text-md leading-tight font-semibold tracking-[-0.005em]",
        className,
      )}
      {...props}
    />
  )
}

function SectionContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="section-content"
      className={cn("py-4", className)}
      {...props}
    />
  )
}

export { Section, SectionContent, SectionHeader, SectionTitle }
