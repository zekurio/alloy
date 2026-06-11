import { cn } from "alloy-ui/lib/utils"
import * as React from "react"

function GridFrame({
  className,
  baseClassName,
  ...props
}: React.ComponentProps<"div"> & { baseClassName: string }) {
  return <div className={cn(baseClassName, className)} {...props} />
}

export function ClipGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    // Container query context: columns ramp with the grid's own width, not the
    // viewport. That keeps the cadence dense on the full-bleed home feed and
    // still sized correctly inside the narrower floating profile card.
    <div className="@container">
      <GridFrame
        data-slot="clip-grid"
        baseClassName={cn(
          "grid grid-cols-1 gap-x-4 gap-y-6 @sm:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-5 @[100rem]:grid-cols-6",
          "[&>*]:[contain-intrinsic-size:260px] [&>*]:[content-visibility:auto]",
        )}
        className={className}
        {...props}
      />
    </div>
  )
}

export function GameRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <GridFrame
      baseClassName={cn(
        "grid gap-4",
        "[grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]",
        "xl:[grid-template-columns:repeat(6,minmax(0,1fr))]",
      )}
      className={className}
      {...props}
    />
  )
}
