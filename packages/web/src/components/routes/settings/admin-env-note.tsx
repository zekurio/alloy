import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"

/**
 * Marks an admin setting as locked by an environment variable. Rendered as a
 * span so it can live inside SettingRow's <p> description.
 */
export function EnvManagedNote({
  envName,
  className,
}: {
  envName: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "text-foreground-muted mt-1 flex flex-wrap items-center gap-1 text-xs",
        className,
      )}
    >
      {t("Managed by environment variable")}:{" "}
      <code className="bg-surface-raised text-foreground-dim text-2xs rounded px-1 py-px font-mono">
        {envName}
      </code>
    </span>
  )
}
