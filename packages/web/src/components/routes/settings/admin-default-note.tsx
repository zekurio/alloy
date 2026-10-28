import { isObjectRecord, type ContractJsonValue } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"

/** Structural equality for config values: JSON-like data, any key order. */
export function sameConfigValue(
  a: ContractJsonValue,
  b: ContractJsonValue,
): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameConfigValue(item, b[index]))
    )
  }
  if (!isObjectRecord(a) || !isObjectRecord(b)) return false
  const keys = new Set(
    [...Object.keys(a), ...Object.keys(b)].filter(
      (key) => a[key] !== undefined || b[key] !== undefined,
    ),
  )
  return [...keys].every((key) => sameConfigValue(a[key], b[key]))
}

/**
 * Shown under an admin setting whose value differs from its default: the
 * environment's value, else Alloy's own. Reset restores the default, which
 * hands the setting back to the environment. Rendered as spans and a button
 * so it can live inside SettingRow's <p> description.
 */
export function AdminDefaultNote<Value extends ContractJsonValue>({
  value,
  defaultValue,
  label,
  onReset,
  disabled,
  className,
}: {
  value: Value
  defaultValue: Value
  /** The default as the setting displays it. */
  label: string
  onReset: () => void
  disabled?: boolean
  className?: string
}) {
  if (sameConfigValue(value, defaultValue)) return null
  return (
    <span
      className={cn(
        "text-foreground-muted mt-1 flex flex-wrap items-center gap-x-1.5 text-xs",
        className,
      )}
    >
      <span>{t("Default: {value}", { value: label })}</span>
      <button
        type="button"
        className="text-foreground-dim hover:text-foreground underline underline-offset-2 disabled:opacity-50"
        onClick={onReset}
        disabled={disabled}
      >
        {t("Reset")}
      </button>
    </span>
  )
}
