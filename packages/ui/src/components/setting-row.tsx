import { cn } from "@alloy/ui/lib/utils"
import type { ReactNode } from "react"

/**
 * Stack of {@link SettingRow}s. The hairline dividers and the collapsed padding
 * at the group's edges come from `:first-child`/`:last-child`, so this must hold
 * rows and nothing else: a stray sibling takes the edge treatment itself and
 * leaves the row beside it with a divider that separates nothing. Content that
 * belongs to a single row (a warning, a validation message) goes in that row's
 * `footer` instead of next to it.
 */
export function SettingRows({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn("flex flex-col", className)}>{children}</div>
}

/**
 * Compact settings row: title (+ optional description) on the left, a control on
 * the right. Stack these inside {@link SettingRows} to get the sectioned list.
 */
export function SettingRow({
  title,
  description,
  footer,
  htmlFor,
  align = "center",
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  /** Full-width content below the row, e.g. a callout about this setting. */
  footer?: ReactNode
  /** When set, the title renders as a <label> bound to this control id. */
  htmlFor?: string
  /** Vertical alignment of the control against the text block. */
  align?: "center" | "start"
  /** The control rendered on the right. */
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "not-last:border-border flex flex-col gap-3 py-4 not-last:border-b first:pt-0 last:pb-0",
        className,
      )}
    >
      <div
        className={cn(
          "flex justify-between gap-4",
          align === "center" ? "items-center" : "items-start",
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
            <p className="text-foreground-dim mt-1 text-xs">{description}</p>
          ) : null}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
      {footer}
    </div>
  )
}
