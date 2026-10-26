import type { AdminRuntimeConfig } from "@alloy/api"
import type { ThemeAccents } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { setServerThemeAccents } from "@alloy/ui/lib/theme"
import {
  defaultThemeAccent,
  normalizeThemeColor,
  THEME_APPEARANCES,
  type ThemeAppearance,
} from "@alloy/ui/lib/theme-colors"
import { cn } from "@alloy/ui/lib/utils"
import { CheckIcon, RotateCcwIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import { HexColorInput } from "@/components/routes/settings/hex-color-input"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"

/**
 * Starting points per appearance, the same hues in each; any color works, and
 * contrast is fixed up per theme.
 */
const ACCENT_PRESETS = {
  dark: [
    "#d0c4eb",
    "#6d8cf5",
    "#38bdf8",
    "#2dd4bf",
    "#4ade80",
    "#facc15",
    "#fb923c",
    "#f43f5e",
    "#ec4899",
  ],
  light: [
    "#5d4f96",
    "#3b5bdb",
    "#0369a1",
    "#0f766e",
    "#13793a",
    "#975c06",
    "#bb3e0b",
    "#be123c",
    "#be185d",
  ],
} as const satisfies Record<ThemeAppearance, readonly string[]>

/**
 * The Alloy theme's accents for everyone on the server, one per appearance.
 * The page previews the draft right away; members on another theme keep its
 * own accent.
 */
export function AdminAccentSettings({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const saved = config.appearance.accentColors
  const [draft, setDraft] = useState<ThemeAccents>(saved)
  const savedRef = useRef(saved)
  const saveAccents = useAdminConfigMutation(
    (accentColors: ThemeAccents) =>
      api.admin.updateAppearanceConfig({ accentColors }),
    { authConfigChanged: true },
  )

  useEffect(() => {
    savedRef.current = saved
    setDraft(saved)
    // A refetch hands over a new object with the same colors.
  }, [saved.light, saved.dark])
  useEffect(() => setServerThemeAccents(draft), [draft])
  // Leaving without saving drops the preview.
  useEffect(() => () => setServerThemeAccents(savedRef.current), [])

  useSettingsSaveBar({
    dirty: draft.light !== saved.light || draft.dark !== saved.dark,
    saving: saveAccents.isPending,
    save: async () => {
      await saveAccents.mutateAsync(draft)
    },
    discard: () => setDraft(saved),
  })

  return (
    <SettingsSubsection
      id="accent-color"
      title={t("Accent color")}
      description={t(
        "Colors buttons, links, and highlights in the Alloy theme for everyone on this server.",
      )}
    >
      <SettingRows>
        {THEME_APPEARANCES.map((appearance) => (
          <ServerAccentRow
            key={appearance}
            appearance={appearance}
            value={draft[appearance]}
            onChange={(accent) =>
              setDraft((current) => ({ ...current, [appearance]: accent }))
            }
          />
        ))}
      </SettingRows>
    </SettingsSubsection>
  )
}

function ServerAccentRow({
  appearance,
  value,
  onChange,
}: {
  appearance: ThemeAppearance
  value: string | null
  onChange: (accent: string | null) => void
}) {
  const id = `server-accent-${appearance}`
  const label =
    appearance === "light" ? t("Light mode accent") : t("Dark mode accent")

  return (
    <SettingRow
      title={label}
      htmlFor={id}
      stack
      footer={
        <div
          role="group"
          aria-label={t("Suggested accents")}
          className="flex flex-wrap gap-2"
        >
          {ACCENT_PRESETS[appearance].map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={preset}
              aria-pressed={value === preset}
              onClick={() => onChange(preset)}
              className={cn(
                "focus-visible:ring-ring focus-visible:ring-offset-background grid size-7 place-items-center rounded-full border-2 transition-[border-color] outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                value === preset
                  ? "border-foreground"
                  : "border-transparent hover:border-border-emphasis",
              )}
              style={{ background: preset }}
            >
              {value === preset ? (
                <CheckIcon
                  aria-hidden
                  className={cn(
                    "size-3.5",
                    appearance === "light" ? "text-white" : "text-black/80",
                  )}
                  strokeWidth={3}
                />
              ) : null}
            </button>
          ))}
        </div>
      }
    >
      <HexColorInput
        id={id}
        value={value ?? defaultThemeAccent(appearance)}
        label={label}
        className="text-xs"
        commit={normalizeThemeColor}
        onChange={(color) => onChange(color.toLowerCase())}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!value}
          onClick={() => onChange(null)}
        >
          <RotateCcwIcon />
          {t("Reset")}
        </Button>
      </HexColorInput>
    </SettingRow>
  )
}
