import { t } from "@alloy/i18n"
import { ColorPicker } from "@alloy/ui/components/color-picker"
import { Input } from "@alloy/ui/components/input"
import {
  clearTokenOverride,
  readTokenOverrides,
  resolveTokenValue,
  writeTokenOverride,
} from "@alloy/ui/lib/custom-theme"
import {
  THEME_VARIABLE_GROUPS,
  THEME_VARIABLES,
} from "@alloy/ui/lib/theme-variables"
import { cn } from "@alloy/ui/lib/utils"
import { useMemo } from "react"

/**
 * Fluxer-style token grid. Edits are written straight back into the CSS text
 * rather than kept as a parallel structure, so the grid and the editor below it
 * are always describing the same document.
 */
export function ThemeTokenEditor({
  css,
  onCssChange,
  search,
}: {
  css: string
  onCssChange: (next: string) => void
  search: string
}) {
  const overrides = useMemo(() => readTokenOverrides(css), [css])
  const normalized = search.trim().toLowerCase()

  const groups = THEME_VARIABLE_GROUPS.map((group) => ({
    ...group,
    variables: THEME_VARIABLES.filter(
      (variable) =>
        variable.groupId === group.id &&
        (!normalized ||
          variable.name.toLowerCase().includes(normalized) ||
          variable.label.toLowerCase().includes(normalized)),
    ),
  })).filter((group) => group.variables.length > 0)

  if (groups.length === 0) {
    return (
      <p className="text-foreground-dim text-sm">{t("No tokens found.")}</p>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-3">
          <h4 className="text-foreground text-sm font-semibold">
            {group.label}
          </h4>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {group.variables.map((variable) => (
              <TokenField
                key={variable.name}
                name={variable.name}
                label={variable.label}
                kind={variable.kind}
                value={resolveTokenValue(variable.name, overrides)}
                overridden={variable.name in overrides}
                onChange={(next) =>
                  onCssChange(
                    next
                      ? writeTokenOverride(css, variable.name, next)
                      : clearTokenOverride(css, variable.name),
                  )
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TokenField({
  name,
  label,
  kind,
  value,
  overridden,
  onChange,
}: {
  name: string
  label: string
  kind: string
  value: string
  overridden: boolean
  onChange: (next: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={`token-${name}`}
        className={cn(
          "truncate text-xs font-medium",
          overridden ? "text-accent" : "text-foreground-dim",
        )}
        title={name}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={`token-${name}`}
          value={value}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        {kind === "color" ? (
          <ColorPicker
            value={value}
            onValueChange={onChange}
            label={t("Pick a color for {token}", { token: label })}
          />
        ) : null}
      </div>
    </div>
  )
}
