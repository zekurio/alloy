import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

function GridFrame({
  className,
  baseClassName,
  ...props
}: ComponentProps<"div"> & { baseClassName: string }) {
  return <div className={cn(baseClassName, className)} {...props} />
}

export function ClipGrid({
  className,
  masonry,
  ...props
}: ComponentProps<"div"> & { masonry?: boolean }) {
  if (masonry)
    return (
      <div
        className={cn(
          "columns-1 gap-2 md:columns-[260px] [&>*]:mb-2 [&>*]:break-inside-avoid",
          // WebKit fails to paint multicol content beyond the first column
          // when the grid sits inside an overflow scroll container; forcing a
          // compositing layer on the grid works around it.
          "[transform:translateZ(0)]",
          className,
        )}
        {...props}
      />
    )
  return (
    <GridFrame
      data-slot="clip-grid"
      baseClassName={cn(
        // Columns floor at 380px (the `TopClipsRow` deck slide width) and
        // stretch with `1fr` to fill the row, so there's no dead right gutter.
        "grid grid-cols-1 gap-x-4 gap-y-6 md:[grid-template-columns:repeat(auto-fill,minmax(min(380px,100%),1fr))]",
        // content-visibility inside a scroll container has known iOS WebKit
        // scroll-geometry bugs (wrong scrollHeight, unscrollable regions), so
        // the render-skipping optimization is desktop-only.
        "md:[&>*]:[contain-intrinsic-size:260px] md:[&>*]:[content-visibility:auto]",
      )}
      className={className}
      {...props}
    />
  )
}
