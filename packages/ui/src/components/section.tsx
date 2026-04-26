import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

function SectionDiv({
  slot,
  baseClassName,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  slot: string
  baseClassName: string
}) {
  return (
    <div
      data-slot={slot}
      className={cn(baseClassName, className)}
      {...props}
    />
  )
}

function Section({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <SectionDiv
      slot="section"
      baseClassName="flex flex-col"
      className={className}
      {...props}
    />
  )
}

function SectionHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <SectionDiv
      slot="section-header"
      baseClassName="flex items-start justify-between gap-3 border-b border-border pb-4"
      className={className}
      {...props}
    />
  )
}

function SectionTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <SectionDiv
      slot="section-title"
      baseClassName="text-md leading-tight font-semibold tracking-[-0.005em]"
      className={className}
      {...props}
    />
  )
}

function SectionContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <SectionDiv
      slot="section-content"
      baseClassName="py-4"
      className={className}
      {...props}
    />
  )
}

function SectionFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <SectionDiv
      slot="section-footer"
      baseClassName="flex items-center justify-end gap-2 border-t border-border pt-4"
      className={className}
      {...props}
    />
  )
}

export { Section, SectionHeader, SectionTitle, SectionContent, SectionFooter }
