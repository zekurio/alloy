import type { AdminRuntimeConfig } from "@alloy/api"
import type { ThemeAccents } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { ColorPicker } from "@alloy/ui/components/color-picker"
import { setServerThemeAccents } from "@alloy/ui/lib/theme"
import {
  defaultThemeAccent,
  normalizeThemeColor,
  THEME_APPEARANCES,
  type ThemeAppearance,
} from "@alloy/ui/lib/theme-colors"
import { cn } from "@alloy/ui/lib/utils"
import { useForm, useStore } from "@tanstack/react-form"
import { useEffect, useEffectEvent } from "react"

import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"

type AccentPair = Record<ThemeAppearance, string>

/**
 * Starting points, Alloy's own first: one hue each, in a shade per
 * appearance. Any color works, and contrast is fixed up per theme.
 */
const ACCENT_PRESETS: readonly AccentPair[] = [
  { light: defaultThemeAccent("light"), dark: defaultThemeAccent("dark") },
  { light: "#3b5bdb", dark: "#6d8cf5" },
  { light: "#0369a1", dark: "#38bdf8" },
  { light: "#0f766e", dark: "#2dd4bf" },
  { light: "#13793a", dark: "#4ade80" },
  { light: "#975c06", dark: "#facc15" },
  { light: "#bb3e0b", dark: "#fb923c" },
  { light: "#be123c", dark: "#f43f5e" },
  { light: "#be185d", dark: "#ec4899" },
]

/**
 * The Alloy theme's accents for everyone on the server. A preset sets both
 * appearances at once; the pickers tune one. The page previews the draft
 * right away; members on another theme keep its own accent.
 */
export function AdminAccentSettings({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const saved = config.appearance.accentColors
  const saveAccents = useAdminConfigMutation(
    (accentColors: ThemeAccents) =>
      api.admin.updateAppearanceConfig({ accentColors }),
    { authConfigChanged: true },
  )
  // The form adopts a refetched pair only while untouched, so edits survive
  // a refetch.
  const form = useForm({
    defaultValues: saved,
    onSubmit: async ({ value, formApi }) => {
      const updated = await saveAccents.mutateAsync(value)
      formApi.reset(updated.appearance.accentColors, {
        keepDefaultValues: true,
      })
    },
  })
  const draft = useStore(form.store, (state) => state.values)

  useEffect(() => setServerThemeAccents(draft), [draft])
  // Leaving without saving drops the preview.
  const restoreSaved = useEffectEvent(() => setServerThemeAccents(saved))
  useEffect(() => () => restoreSaved(), [])

  useSettingsSaveBar(form, {
    dirty: draft.light !== saved.light || draft.dark !== saved.dark,
    saving: saveAccents.isPending,
  })

  const accent = (appearance: ThemeAppearance) =>
    draft[appearance] ?? defaultThemeAccent(appearance)

  return (
    <SettingsSubsection
      id="accent-color"
      title={t("Accent color")}
      description={t(
        "Colors buttons, links, and highlights in the Alloy theme for everyone on this server.",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div
          role="group"
          aria-label={t("Suggested accents")}
          className="flex flex-wrap gap-2.5"
        >
          {ACCENT_PRESETS.map((preset, index) => {
            const name =
              index === 0
                ? t("Alloy default")
                : `${preset.light} / ${preset.dark}`
            const selected = THEME_APPEARANCES.every(
              (appearance) => accent(appearance) === preset[appearance],
            )
            return (
              <button
                key={preset.dark}
                type="button"
                aria-label={name}
                title={name}
                aria-pressed={selected}
                onClick={() => {
                  form.setFieldValue(
                    "light",
                    storedAccent("light", preset.light),
                  )
                  form.setFieldValue("dark", storedAccent("dark", preset.dark))
                }}
                className={cn(
                  "ring-offset-background size-7 rounded-full ring-offset-2 outline-offset-4 transition-shadow",
                  selected
                    ? "ring-foreground ring-2"
                    : "hover:ring-border-emphasis hover:ring-2",
                )}
                style={{
                  // A hard stop on a diagonal stair-steps; a pixel of blend
                  // smooths it.
                  background: `linear-gradient(135deg, ${preset.light} calc(50% - 0.5px), ${preset.dark} calc(50% + 0.5px))`,
                }}
              />
            )
          })}
        </div>
        <div className="flex items-center gap-4">
          {THEME_APPEARANCES.map((appearance) => (
            <div
              key={appearance}
              className="text-foreground-dim flex items-center gap-2 text-sm"
            >
              <span aria-hidden>
                {appearance === "light" ? t("Light") : t("Dark")}
              </span>
              <ColorPicker
                value={accent(appearance)}
                label={
                  appearance === "light"
                    ? t("Light mode accent")
                    : t("Dark mode accent")
                }
                hexInput
                onValueChange={(color) =>
                  form.setFieldValue(
                    appearance,
                    storedAccent(appearance, color),
                  )
                }
              />
            </div>
          ))}
        </div>
      </div>
    </SettingsSubsection>
  )
}

/** Alloy's own accent is stored as none, so the server keeps following it. */
function storedAccent(
  appearance: ThemeAppearance,
  color: string,
): string | null {
  const hex = normalizeThemeColor(color)
  return hex === defaultThemeAccent(appearance) ? null : hex
}
