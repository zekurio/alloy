import { cn } from "@workspace/ui/lib/utils"

/**
 * Visual subsection within a config card / form.
 * Renders a title + optional description, followed by grouped children.
 * Consecutive `FormGroup`s are separated by a top border matching the
 * `py-3` / `border-b` rhythm used by `ToggleRow` and `ConfigTransferSection`.
 */
export function FormGroup({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-border py-3 not-first:border-t first:pt-0 last:pb-0",
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? (
          <p className="text-xs text-foreground-dim">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}
