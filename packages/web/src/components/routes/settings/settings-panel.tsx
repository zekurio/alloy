import * as React from "react"

interface SettingsPanelProps {
  title: string
  description?: string
  children: React.ReactNode
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
