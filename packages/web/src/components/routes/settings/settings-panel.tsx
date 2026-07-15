import type { ReactNode } from "react"

interface SettingsPanelProps {
  title: string
  description?: string
  children: ReactNode
}

export function SettingsPanel({
  title,
  description,
  children,
}: SettingsPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold tracking-[var(--tracking-tight)]">
          {title}
        </h2>
        {description ? (
          <p className="text-foreground-dim text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/**
 * A titled block within a settings page. Pages stack these in a
 * `flex flex-col gap-6` container, divided by `<hr className="border-border" />`,
 * so every page reads the same way under the shared {@link SettingsPanel} header.
 */
export function SettingsSubsection({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  /** Optional control rendered to the right of the header. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-foreground text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="text-foreground-dim text-xs">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}
