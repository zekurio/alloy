import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { ClipCardSkeleton } from "./clip-card-skeleton"

export function ClipGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="clip-grid"
      className={cn(
        "grid gap-6",
        "grid-cols-1 md:grid-cols-3 xl:grid-cols-5",
        "[&>*]:[contain-intrinsic-size:260px] [&>*]:[content-visibility:auto]",
        className
      )}
      {...props}
    />
  )
}

type ClipGridSkeletonProps = Omit<
  React.ComponentProps<typeof ClipGrid>,
  "children"
> & {
  count?: number
}

export function ClipGridSkeleton({
  count = 5,
  ...props
}: ClipGridSkeletonProps) {
  return (
    <ClipGrid {...props}>
      {Array.from({ length: count }, (_, i) => (
        <ClipCardSkeleton key={i} />
      ))}
    </ClipGrid>
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
