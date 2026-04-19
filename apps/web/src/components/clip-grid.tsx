import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Grid container for `ClipCard` rows.
 *
 * Five columns at xl, auto-fill below with a 240px minimum so cards
 * reflow cleanly on narrower viewports without shrinking past the
 * point where the title + stats stop reading as a card.
 *
 * `content-visibility: auto` skips layout/paint for grid rows that are
 * off-screen — the recent-clips feed can get long, and each cell's
 * 240px intrinsic-size estimate lets the browser still reserve vertical
 * space without actually rendering the card. This is the Vercel rules
 * `rendering-content-visibility` hit.
 */
export function ClipGrid({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="clip-grid"
      className={cn(
        "grid gap-6",
        "[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]",
        "xl:[grid-template-columns:repeat(5,minmax(0,1fr))]",
        "[&>*]:[content-visibility:auto] [&>*]:[contain-intrinsic-size:260px]",
        className
      )}
      {...props}
    />
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
