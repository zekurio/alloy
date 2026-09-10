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
          "columns-2 gap-2 sm:columns-[260px] [&>*]:mb-2 [&>*]:break-inside-avoid",
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
        "grid gap-x-4 gap-y-6 [grid-template-columns:repeat(auto-fill,minmax(min(380px,100%),1fr))]",
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
