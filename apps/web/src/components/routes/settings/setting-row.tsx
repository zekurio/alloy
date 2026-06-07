import { cn } from "alloy-ui/lib/utils"
import * as React from "react"

/**
 * Compact settings row: title (+ optional description) on the left, a control on
 * the right, with hairline dividers between adjacent rows. Stack these inside a
 * plain container to get the Medal-style sectioned list.
 */
export function SettingRow({
  title,
  description,
  htmlFor,
  children,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** When set, the title renders as a <label> bound to this control id. */
  htmlFor?: string
  /** The control rendered on the right. */
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "not-last:border-border flex items-center justify-between gap-4 py-3 not-last:border-b first:pt-0 last:pb-0",
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {title}
          </label>
        ) : (
          <div className="text-sm font-medium">{title}</div>
        )}
        {description ? (
          <p className="text-foreground-dim mt-0.5 text-xs">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
