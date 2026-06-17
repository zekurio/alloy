import { cn } from "@alloy/ui/lib/utils"
import type * as React from "react"

type MediaPageFrameDivProps = React.ComponentProps<"div"> & {
  baseClassName: string
}

function MediaPageFrameDiv({
  baseClassName,
  className,
  ...props
}: MediaPageFrameDivProps) {
  return <div className={cn(baseClassName, className)} {...props} />
}

function MediaPageContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <MediaPageFrameDiv
      baseClassName="relative z-10 min-h-full min-w-0 px-0 py-0 [grid-area:1/1] sm:px-6 sm:py-6 lg:px-10"
      className={className}
      {...props}
    />
  )
}

function MediaPageCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <MediaPageFrameDiv
      baseClassName="min-w-0 overflow-hidden sm:rounded-2xl sm:ring-1 sm:ring-border/60 sm:shadow-[var(--shadow-lg)]"
      className={className}
      {...props}
    />
  )
}

function MediaPageBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <MediaPageFrameDiv
      baseClassName="bg-surface-sunken/55 relative min-w-0 px-4 pb-4 backdrop-blur-2xl backdrop-saturate-150 sm:px-6 sm:pb-8"
      className={className}
      {...props}
    />
  )
}

function MediaPageBottomSpacer() {
  return <div aria-hidden className="h-0 sm:h-6" />
}

export { MediaPageBody, MediaPageBottomSpacer, MediaPageCard, MediaPageContent }
