import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ColorPicker } from "@alloy/ui/components/color-picker"
import { Input } from "@alloy/ui/components/input"
import { THEME_STORAGE_KEY } from "@alloy/ui/lib/theme"
import {
  readThemeAccents,
  themeAccentToHex,
  type ThemeAccentState,
  writeThemeAccents,
} from "@alloy/ui/lib/theme-accent"
import {
  getStoredThemePaletteId,
  setStoredThemePalette,
  THEME_PALETTES,
  type ThemePalette,
  type ThemePresetMode,
  type ThemePresetTokens,
} from "@alloy/ui/lib/theme-presets"
import { refreshThemePreferences } from "@alloy/ui/lib/theme-storage"
import { cn } from "@alloy/ui/lib/utils"
import { CheckIcon, MoonIcon, RotateCcwIcon, SunIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"

export function ThemeSettings() {
  const [paletteId, setPaletteId] = useState(getStoredThemePaletteId)
  const [accentState, setAccentState] = useState(readThemeAccents)

  useEffect(() => {
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
      refreshThemePreferences()
      setPaletteId(getStoredThemePaletteId())
      setAccentState(readThemeAccents())
    }
    window.addEventListener("storage", syncStoredTheme)
    return () => window.removeEventListener("storage", syncStoredTheme)
  }, [])

  const selectedTheme =
    THEME_PALETTES.find((palette) => palette.id === paletteId) ??
    THEME_PALETTES[0]!

  function chooseTheme(id: ThemePalette["id"]) {
    setPaletteId(id)
    setStoredThemePalette(id)
    // Recalculate contrast-aware accent tokens against the new backgrounds.
    writeThemeAccents(accentState)
  }

  function saveAccent(mode: ThemePresetMode, accent: string) {
    const next: ThemeAccentState = {
      accents: { ...accentState.accents, [mode]: accent },
    }
    setAccentState(next)
    writeThemeAccents(next)
  }

  function resetAccent(mode: ThemePresetMode) {
    const accents = { ...accentState.accents }
    delete accents[mode]
    const next: ThemeAccentState = { accents }
    setAccentState(next)
    writeThemeAccents(next)
  }

  return (
    <SettingsSubsection
      id="themes"
      title={t("Themes")}
      description={t(
        "Choose a base palette with matching light and dark appearances.",
      )}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {THEME_PALETTES.map((theme) => (
          <ThemeCard
            key={theme.id}
            label={theme.label}
            lightTokens={theme.light.tokens}
            darkTokens={theme.dark.tokens}
            selected={theme.id === paletteId}
            onSelect={() => chooseTheme(theme.id)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-medium">{t("Accent")}</h4>
          <p className="text-foreground-dim mt-1 text-xs">
            {t("Choose separate colors for light and dark mode.")}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <AccentColorField
            mode="light"
            value={
              accentState.accents.light ?? selectedTheme.light.tokens.accent
            }
            customized={Boolean(accentState.accents.light)}
            onChange={(accent) => saveAccent("light", accent)}
            onReset={() => resetAccent("light")}
          />
          <AccentColorField
            mode="dark"
            value={accentState.accents.dark ?? selectedTheme.dark.tokens.accent}
            customized={Boolean(accentState.accents.dark)}
            onChange={(accent) => saveAccent("dark", accent)}
            onReset={() => resetAccent("dark")}
          />
        </div>
      </div>
    </SettingsSubsection>
  )
}

function AccentColorField({
  mode,
  value,
  customized,
  onChange,
  onReset,
}: {
  mode: ThemePresetMode
  value: string
  customized: boolean
  onChange: (value: string) => void
  onReset: () => void
}) {
  const [draft, setDraft] = useState(value)
  const label = mode === "light" ? t("Light") : t("Dark")

  useEffect(() => setDraft(value), [value])

  function updateDraft(next: string) {
    setDraft(next)
    if (/^#[0-9a-f]{6}$/i.test(next.trim())) onChange(next.toLowerCase())
  }

  function commitDraft() {
    const color = themeAccentToHex(draft)
    if (color) {
      setDraft(color)
      onChange(color)
      return
    }
    setDraft(value)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
      <label
        htmlFor={`theme-accent-${mode}`}
        className="flex items-center gap-1.5"
      >
        {mode === "light" ? (
          <SunIcon className="size-3.5" strokeWidth={2.5} />
        ) : (
          <MoonIcon className="size-3.5" strokeWidth={2.5} />
        )}
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={`theme-accent-${mode}`}
          value={draft}
          spellCheck={false}
          aria-label={label}
          className="min-w-0 flex-1 font-mono text-xs"
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={commitDraft}
        />
        <ColorPicker
          value={value}
          allowAlpha={false}
          onValueChange={updateDraft}
          label={label}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={onReset}
        disabled={!customized}
      >
        <RotateCcwIcon />
        {t("Reset")}
      </Button>
    </div>
  )
}

function ThemeCard({
  label,
  lightTokens,
  darkTokens,
  selected,
  onSelect,
}: {
  label: string
  lightTokens: ThemePresetTokens
  darkTokens: ThemePresetTokens
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
        <ThemePreview mode="light" tokens={lightTokens} />
        <ThemePreview mode="dark" tokens={darkTokens} />
      </div>
      <div className="flex items-center justify-between gap-2 px-1 pt-2">
        <span className="truncate text-sm font-medium">{label}</span>
        <span
          aria-hidden
          className={cn(
            "bg-accent text-accent-foreground flex size-5 shrink-0 items-center justify-center rounded-full",
            !selected && "invisible",
          )}
        >
          <CheckIcon className="size-3" />
        </span>
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
        className="absolute bottom-1 left-1"
        style={{ color: tokens.neutrals[9] }}
      >
        {mode === "light" ? (
          <SunIcon className="size-3.5" strokeWidth={2.5} />
        ) : (
          <MoonIcon className="size-3.5" strokeWidth={2.5} />
        )}
      </span>
    </span>
  )
}
