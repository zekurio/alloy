import { cn } from "@alloy/ui/lib/utils"

export function FormGroup({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: string
  /** Optional control rendered top-right, aligned with the title. */
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  const hasHeader = Boolean(title || description || action)

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-border py-3 not-first:border-t first:pt-0 last:pb-0",
        className,
      )}
    >
      {hasHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <div className="text-sm font-medium">{title}</div> : null}
            {description ? (
              <p className="text-foreground-dim text-xs">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}
