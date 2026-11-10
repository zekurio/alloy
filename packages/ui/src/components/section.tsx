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

function SectionContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="section-content"
      className={cn("py-4", className)}
      {...props}
    />
  )
}

export { Section, SectionContent }
