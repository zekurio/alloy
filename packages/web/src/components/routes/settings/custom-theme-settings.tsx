import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { ColorPicker } from "@alloy/ui/components/color-picker"
import { Input } from "@alloy/ui/components/input"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import {
  clearLegacyCustomCss,
  LEGACY_CUSTOM_CSS_STORAGE_KEY,
  readLegacyCustomCss,
} from "@alloy/ui/lib/custom-theme"
import { getStoredTheme, resolveTheme } from "@alloy/ui/lib/theme"
import {
  createGuidedThemeColors,
  readThemeCustomization,
  themeColorsFromTokens,
  themeColorsToTokens,
  themeColorToHex,
  THEME_CUSTOMIZATION_STORAGE_KEY,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeCustomizationState,
  type ThemePaletteCustomization,
  writeThemeCustomization,
} from "@alloy/ui/lib/theme-customization"
import {
  getStoredThemePaletteId,
  setStoredThemePalette,
  THEME_PALETTES,
  THEME_PALETTE_STORAGE_KEY,
  type ThemePalette,
  type ThemePresetMode,
  type ThemePresetTokens,
} from "@alloy/ui/lib/theme-presets"
import { cn } from "@alloy/ui/lib/utils"
import {
  CheckIcon,
  FileOutputIcon,
  MoonIcon,
  RotateCcwIcon,
  SunIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { startBlobDownload } from "@/lib/browser-download"
import { useCustomThemeEditor } from "@/lib/custom-theme"

const FOUNDATION_ROLES: readonly ThemeColorRole[] = [
  "background",
  "surface",
  "surfaceRaised",
  "surfaceSunken",
  "text",
  "textMuted",
  "input",
  "border",
]

const BRAND_ROLES: readonly ThemeColorRole[] = [
  "accent",
  "success",
  "warning",
  "danger",
  "info",
  "live",
]

const ROLE_LABELS = {
  background: t("Background"),
  surface: t("Surface"),
  surfaceRaised: t("Raised surface"),
  surfaceSunken: t("Sunken surface"),
  text: t("Text"),
  textMuted: t("Muted text"),
  input: t("Input"),
  border: t("Border"),
  accent: t("Accent (light & dark)"),
  success: t("Success"),
  warning: t("Warning"),
  danger: t("Danger"),
  info: t("Info"),
  live: t("Live"),
} satisfies Record<ThemeColorRole, string>

/** Browser-local, structured theming. Raw CSS remains an administrator tool. */
export function CustomThemeSettings() {
  const { theme: instanceTheme, update: updateInstanceTheme } =
    useCustomThemeEditor()
  const [paletteId, setPaletteId] = useState(getStoredThemePaletteId)
  const [customization, setCustomization] = useState(readThemeCustomization)
  const [legacyCss, setLegacyCss] = useState(readLegacyCustomCss)
  const [legacyDownloadFailed, setLegacyDownloadFailed] = useState(false)
  const [advancedEditor, setAdvancedEditor] = useState<
    Partial<Record<ThemePresetMode, boolean>>
  >({})
  const [appearance, setAppearance] = useState<ThemePresetMode>(() =>
    resolveTheme(getStoredTheme()),
  )

  useEffect(() => {
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_PALETTE_STORAGE_KEY) {
        setPaletteId(getStoredThemePaletteId())
      }
      if (event.key === null || event.key === THEME_CUSTOMIZATION_STORAGE_KEY) {
        setCustomization(readThemeCustomization())
        setAdvancedEditor({})
      }
      if (event.key === null || event.key === LEGACY_CUSTOM_CSS_STORAGE_KEY) {
        setLegacyCss(readLegacyCustomCss())
        setLegacyDownloadFailed(false)
      }
    }
    window.addEventListener("storage", syncStoredTheme)
    return () => window.removeEventListener("storage", syncStoredTheme)
  }, [])

  const selectedTheme =
    THEME_PALETTES.find((palette) => palette.id === paletteId) ??
    THEME_PALETTES[0]!
  const baseColors = themeColorsFromTokens(
    selectedTheme[appearance].tokens,
    appearance,
  )
  const palette = customization.palettes[appearance]
  const isAdvanced = palette?.advanced ?? advancedEditor[appearance] ?? false
  const paletteColors = palette?.colors ?? baseColors
  const colors = customization.accent
    ? { ...paletteColors, accent: customization.accent }
    : paletteColors

  function downloadLegacyCss() {
    setLegacyDownloadFailed(
      !startBlobDownload(
        new Blob([legacyCss], { type: "text/css" }),
        "alloy-legacy-theme.css",
      ),
    )
  }

  function removeLegacyCss() {
    clearLegacyCustomCss()
    setLegacyCss("")
    setLegacyDownloadFailed(false)
  }

  function chooseTheme(id: string) {
    setPaletteId(id)
    setStoredThemePalette(id)
    writeThemeCustomization(customization)
  }

  function saveCustomization(next: ThemeCustomizationState) {
    setCustomization(next)
    writeThemeCustomization(next)
  }

  function saveColors(nextColors: ThemeColors, advanced: boolean) {
    saveCustomization({
      accent: customization.accent,
      palettes: {
        ...customization.palettes,
        [appearance]: { advanced, colors: nextColors },
      },
    })
  }

  function updateGuidedColor(role: "background" | "accent", value: string) {
    if (role === "accent") {
      saveCustomization({
        ...customization,
        accent: value,
        palettes: {
          dark: retintGuidedPalette(
            customization.palettes.dark,
            "dark",
            value,
            selectedTheme,
          ),
          light: retintGuidedPalette(
            customization.palettes.light,
            "light",
            value,
            selectedTheme,
          ),
        },
      })
      return
    }
    saveColors(
      createGuidedThemeColors(appearance, value, colors.accent, baseColors),
      false,
    )
  }

  function updateAdvancedColor(role: ThemeColorRole, value: string) {
    if (role === "accent") {
      saveCustomization({ ...customization, accent: value })
      return
    }
    saveColors({ ...paletteColors, [role]: value }, true)
  }

  function setAdvanced(advanced: boolean) {
    if (!palette) {
      setAdvancedEditor({ ...advancedEditor, [appearance]: advanced })
      return
    }
    saveColors(
      advanced
        ? paletteColors
        : createGuidedThemeColors(
            appearance,
            paletteColors.background,
            colors.accent,
            baseColors,
          ),
      advanced,
    )
  }

  function resetAppearance() {
    const palettes =
      appearance === "dark"
        ? customization.palettes.light
          ? { light: customization.palettes.light }
          : {}
        : customization.palettes.dark
          ? { dark: customization.palettes.dark }
          : {}
    setAdvancedEditor({ ...advancedEditor, [appearance]: false })
    saveCustomization({ ...customization, palettes })
  }

  return (
    <>
      <SettingsSubsection
        id="themes"
        title={t("Themes")}
        description={t(
          "Choose a base palette with matching light and dark appearances. Your accent and custom colors layer on top.",
        )}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {THEME_PALETTES.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={theme.id === paletteId}
              onSelect={() => chooseTheme(theme.id)}
            />
          ))}
        </div>
        <SettingRows className="mt-2">
          <SettingRow
            title={t("Use this server's theme")}
            description={t(
              "Allow instance branding underneath your personal color choices.",
            )}
          >
            <Switch
              aria-label={t("Use this server's theme")}
              checked={instanceTheme.serverThemeEnabled}
              onCheckedChange={(serverThemeEnabled) =>
                updateInstanceTheme({ serverThemeEnabled })
              }
            />
          </SettingRow>
        </SettingRows>
        {legacyCss ? (
          <Callout tone="warning">
            <TriangleAlertIcon />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p>
                {t(
                  "Your previous custom CSS is no longer applied. Download a backup, then remove it from this browser.",
                )}
              </p>
              {legacyDownloadFailed ? (
                <p className="text-xs font-medium">
                  {t(
                    "Couldn't download the old CSS. Try again before removing it.",
                  )}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={downloadLegacyCss}
                >
                  <FileOutputIcon />
                  {t("Download old CSS")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={removeLegacyCss}
                >
                  <Trash2Icon />
                  {t("Remove old CSS")}
                </Button>
              </div>
            </div>
          </Callout>
        ) : null}
      </SettingsSubsection>

      <SettingsSubsection
        id="accent-color"
        title={t("Accent color")}
        description={t(
          "Retint actions, links, and focus states across light and dark. Alloy adjusts the seed when needed to keep it readable.",
        )}
      >
        <div className="flex max-w-sm items-end gap-2">
          <div className="min-w-0 flex-1">
            <ThemeColorField
              fieldId="theme-accent-override"
              colorRole="accent"
              value={customization.accent ?? colors.accent}
              onChange={(accent) =>
                saveCustomization({ ...customization, accent })
              }
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            aria-label={t("Use theme accent")}
            onClick={() =>
              saveCustomization({ ...customization, accent: null })
            }
            disabled={!customization.accent}
          >
            <RotateCcwIcon />
          </Button>
        </div>
      </SettingsSubsection>

      <SettingsSubsection
        id="custom-colors"
        title={t("Custom colors")}
        description={t(
          "Pick a background and accent to generate a complete, readable palette, or switch to advanced mode to tune each color family.",
        )}
      >
        <div className="flex flex-wrap items-stretch gap-3">
          <div
            role="group"
            aria-label={t("Custom color appearance")}
            className="bg-surface-raised grid min-w-64 grid-cols-2 rounded-lg p-1"
          >
            {(["light", "dark"] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={appearance === mode ? "secondary" : "ghost"}
                aria-pressed={appearance === mode}
                onClick={() => setAppearance(mode)}
              >
                {mode === "light" ? <SunIcon /> : <MoonIcon />}
                {mode === "light" ? t("Light") : t("Dark")}
              </Button>
            ))}
          </div>
          <div className="h-16 min-w-28 flex-1 overflow-hidden rounded-lg sm:max-w-40">
            <ThemePreview
              mode={appearance}
              tokens={themeColorsToTokens(colors)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-medium">{t("Colors")}</h4>
            <p className="text-foreground-dim mt-1 text-xs">
              {isAdvanced
                ? t(
                    "Related states are grouped. Turning Advanced off regenerates them from the two seed colors.",
                  )
                : t("Two colors, everything else is derived.")}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            {t("Advanced")}
            <Switch
              aria-label={t("Advanced colors")}
              checked={isAdvanced}
              onCheckedChange={setAdvanced}
            />
          </div>
        </div>

        {isAdvanced ? (
          <div className="flex flex-col gap-6">
            <ColorGroup
              title={t("Foundation")}
              roles={FOUNDATION_ROLES}
              colors={colors}
              onChange={updateAdvancedColor}
            />
            <ColorGroup
              title={t("Brand & status")}
              roles={BRAND_ROLES}
              colors={colors}
              onChange={updateAdvancedColor}
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <ThemeColorField
              fieldId={`guided-${appearance}-background`}
              colorRole="background"
              value={colors.background}
              onChange={(value) => updateGuidedColor("background", value)}
            />
            <ThemeColorField
              fieldId={`guided-${appearance}-accent`}
              colorRole="accent"
              value={colors.accent}
              onChange={(value) => updateGuidedColor("accent", value)}
            />
          </div>
        )}

        <Button
          type="button"
          variant="secondary"
          onClick={resetAppearance}
          disabled={!palette}
        >
          <RotateCcwIcon />
          {t("Reset {appearance} colors", { appearance })}
        </Button>
      </SettingsSubsection>
    </>
  )
}

function retintGuidedPalette(
  palette: ThemePaletteCustomization | undefined,
  mode: ThemePresetMode,
  accent: string,
  theme: ThemePalette,
): ThemePaletteCustomization | undefined {
  if (!palette || palette.advanced) return palette
  return {
    advanced: false,
    colors: createGuidedThemeColors(
      mode,
      palette.colors.background,
      accent,
      themeColorsFromTokens(theme[mode].tokens, mode),
    ),
  }
}

function ThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: ThemePalette
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "border-border bg-card hover:bg-surface-raised focus-visible:ring-ring relative overflow-hidden rounded-xl border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
        selected && "border-accent-border ring-accent-border ring-1",
      )}
    >
      <div className="grid h-20 grid-cols-2 overflow-hidden rounded-lg">
        <ThemePreview mode="light" tokens={theme.light.tokens} />
        <ThemePreview mode="dark" tokens={theme.dark.tokens} />
      </div>
      <div className="flex items-center justify-between gap-2 px-1 pt-2">
        <span className="truncate text-sm font-medium">{theme.label}</span>
        {selected ? (
          <span className="bg-accent text-accent-foreground flex size-5 shrink-0 items-center justify-center rounded-full">
            <CheckIcon className="size-3" />
          </span>
        ) : null}
      </div>
    </button>
  )
}

function ThemePreview({
  mode,
  tokens,
}: {
  mode: ThemePresetMode
  tokens: ThemePresetTokens
}) {
  return (
    <span
      aria-hidden
      className="relative block size-full overflow-hidden"
      style={{ background: tokens.neutrals[0] }}
    >
      <span
        className="absolute inset-y-0 left-0 w-1/4 border-r"
        style={{
          background: tokens.neutrals[1],
          borderColor: tokens.neutrals[4],
        }}
      />
      <span
        className="absolute top-3 right-2 h-2 w-1/2 rounded-full"
        style={{ background: tokens.neutrals[9] }}
      />
      <span
        className="absolute top-7 right-2 h-2 w-2/5 rounded-full"
        style={{ background: tokens.neutrals[6] }}
      />
      <span
        className="absolute right-2 bottom-3 size-4 rounded-full"
        style={{ background: tokens.accent }}
      />
      <span
        className="absolute bottom-1 left-1 text-[8px]"
        style={{ color: tokens.neutrals[9] }}
      >
        {mode === "light" ? "L" : "D"}
      </span>
    </span>
  )
}

function ColorGroup({
  title,
  roles,
  colors,
  onChange,
}: {
  title: string
  roles: readonly ThemeColorRole[]
  colors: ThemeColors
  onChange: (role: ThemeColorRole, value: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {roles.map((role) => (
          <ThemeColorField
            key={role}
            fieldId={`advanced-${role}`}
            colorRole={role}
            value={colors[role]}
            onChange={(value) => onChange(role, value)}
          />
        ))}
      </div>
    </div>
  )
}

function ThemeColorField({
  fieldId,
  colorRole,
  value,
  onChange,
}: {
  fieldId: string
  colorRole: ThemeColorRole
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  function updateDraft(next: string) {
    setDraft(next)
    if (/^#[0-9a-f]{6}$/i.test(next.trim())) onChange(next.toLowerCase())
  }

  function commitDraft() {
    const color = themeColorToHex(draft)
    if (color) {
      setDraft(color)
      onChange(color)
      return
    }
    setDraft(value)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
      <label htmlFor={fieldId}>{ROLE_LABELS[colorRole]}</label>
      <div className="flex items-center gap-2">
        <Input
          id={fieldId}
          value={draft}
          spellCheck={false}
          aria-label={t("{label} color", {
            label: ROLE_LABELS[colorRole],
          })}
          className="min-w-0 flex-1 font-mono text-xs"
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={commitDraft}
        />
        <ColorPicker
          value={value}
          allowAlpha={false}
          onValueChange={updateDraft}
          label={t("Pick a color for {label}", {
            label: ROLE_LABELS[colorRole],
          })}
        />
      </div>
    </div>
  )
}
