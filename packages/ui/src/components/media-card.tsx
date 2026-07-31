import { cn } from "@alloy/ui/lib/utils"
import type { ReactNode } from "react"

/**
 * Responsive grid of {@link MediaCard}s. Columns come from a minimum track
 * width rather than viewport breakpoints, because these grids sit inside the
 * settings dialog where the sidebar makes the viewport a poor proxy for how
 * much room the grid actually has.
 */
export function MediaCardGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-4",
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Poster-style browse card: artwork on top, title and meta below. Actions are
 * pinned to the artwork's top-right and always visible, rather than revealed on
 * hover, so they stay reachable by touch.
 */
export function MediaCard({
  media,
  aspect = "portrait",
  title,
  subtitle,
  meta,
  badge,
  actions,
  className,
}: {
  media: ReactNode
  aspect?: "portrait" | "square"
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  /** Rendered over the artwork's top-left, e.g. a status or source badge. */
  badge?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface-raised flex min-w-0 flex-col overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div
        className={cn(
          "bg-surface-sunken relative w-full overflow-hidden",
          aspect === "square" ? "aspect-square" : "aspect-[2/3]",
        )}
      >
        {media}
        {badge ? (
          <div className="absolute top-1.5 left-1.5 flex flex-col items-start gap-1">
            {badge}
          </div>
        ) : null}
        {actions ? (
          <div className="bg-background/70 absolute top-1.5 right-1.5 flex items-center rounded-md backdrop-blur-sm">
            {actions}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 p-3">
        <span className="truncate text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="text-foreground-dim truncate text-xs">
            {subtitle}
          </span>
        ) : null}
        {meta ? (
          <span className="text-foreground-muted truncate text-xs tabular-nums">
            {meta}
          </span>
        ) : null}
      </div>
    </div>
  )
}
