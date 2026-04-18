import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy SectionHead — the title / eyebrow / actions trio that sits above
 * each content block (clip grid, game row, etc.).
 *
 *   <SectionHead>
 *     <div>
 *       <SectionEyebrow>Trending · Updated hourly</SectionEyebrow>
 *       <SectionTitle>
 *         <FireIcon /> Top Clips Today
 *       </SectionTitle>
 *     </div>
 *     <SectionActions>
 *       <Chip data-active>Today</Chip>
 *       <Chip>Week</Chip>
 *     </SectionActions>
 *   </SectionHead>
 */
function SectionHead({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-head"
      className={cn(
        "mb-4 flex items-end justify-between gap-4",
        className
      )}
      {...props}
    />
  )
}

function SectionEyebrow({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-eyebrow"
      className={cn(
        "mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-foreground-faint",
        className
      )}
      {...props}
    />
  )
}

function SectionTitle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-title"
      className={cn(
        "flex items-center gap-2 text-xl font-semibold tracking-[-0.02em] text-foreground",
        "[&_svg]:size-[18px] [&_svg]:shrink-0",
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

function SectionActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-actions"
      className={cn("flex items-center gap-1.5", className)}
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
}
