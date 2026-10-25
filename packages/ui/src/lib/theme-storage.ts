import {
  isObjectRecord,
  isStringValue,
  type ContractJsonInput,
  type ContractJsonValue,
} from "@alloy/contracts"
import { createLocalStorageDriver } from "@alloy/ui/lib/local-storage"
import {
  normalizeThemeColor,
  type ThemeAppearance,
} from "@alloy/ui/lib/theme-colors"
import { DEFAULT_THEME_VARIANT_IDS } from "@alloy/ui/lib/theme-presets"

/** Keep in sync with the pre-paint script in packages/web/index.html. */
export const THEME_STORAGE_KEY = "alloy.theme"

export const THEME_MODES = ["system", "light", "dark"] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export interface ThemePreferences {
  mode: ThemeMode
  /** Variant ids shown in each appearance; unknown ids fall back to Alloy. */
  light: string
  dark: string
  /** Personal accent for the Alloy base themes; null follows the server. */
  accent: string | null
}

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  mode: "system",
  light: DEFAULT_THEME_VARIANT_IDS.light,
  dark: DEFAULT_THEME_VARIANT_IDS.dark,
  accent: null,
}

/**
 * Default variants of the palettes the first theme picker stored as
 * `{ palette, variants, accents }`, so existing choices carry over.
 */
const LEGACY_PALETTES = [
  { palette: "default", ...DEFAULT_THEME_VARIANT_IDS },
  {
    palette: "catppuccin",
    light: "catppuccin-latte",
    dark: "catppuccin-frappe",
  },
  { palette: "nord", light: "nord-light", dark: "nord" },
  { palette: "one", light: "one-light", dark: "one-dark" },
  { palette: "rose-pine", light: "rose-pine-dawn", dark: "rose-pine" },
  { palette: "gruvbox", light: "gruvbox-light", dark: "gruvbox-dark" },
] as const satisfies readonly ({ palette: string } & Record<
  ThemeAppearance,
  string
>)[]

export function normalizeThemePreferences(
  value: ContractJsonInput,
): ThemePreferences {
  if (!isObjectRecord(value)) return { ...DEFAULT_THEME_PREFERENCES }

  const mode =
    THEME_MODES.find((candidate) => candidate === value.mode) ??
    DEFAULT_THEME_PREFERENCES.mode
  if (!isStringValue(value.light) && isStringValue(value.palette)) {
    return { mode, ...migrateLegacyPreferences(value) }
  }

  return {
    mode,
    light: isStringValue(value.light)
      ? value.light
      : DEFAULT_THEME_PREFERENCES.light,
    dark: isStringValue(value.dark)
      ? value.dark
      : DEFAULT_THEME_PREFERENCES.dark,
    accent: isStringValue(value.accent)
      ? normalizeThemeColor(value.accent)
      : null,
  }
}

const themeStorage = createLocalStorageDriver(
  THEME_STORAGE_KEY,
  normalizeThemePreferences,
)

export function readThemePreferences(): ThemePreferences {
  return themeStorage.read()
}

export function refreshThemePreferences(): ThemePreferences {
  return themeStorage.refresh()
}

export function writeThemePreferences(
  preferences: ThemePreferences,
): ThemePreferences {
  return themeStorage.write(preferences)
}

function migrateLegacyPreferences(
  value: Record<string, ContractJsonValue>,
): Omit<ThemePreferences, "mode"> {
  const palette =
    LEGACY_PALETTES.find((entry) => entry.palette === value.palette) ??
    DEFAULT_THEME_VARIANT_IDS
  const variants = isObjectRecord(value.variants) ? value.variants : {}
  const accents = isObjectRecord(value.accents) ? value.accents : {}
  // The old default preset id was shared by both appearances.
  const variant = (appearance: ThemeAppearance) => {
    const stored = variants[appearance]
    return isStringValue(stored) && stored !== "default"
      ? stored
      : palette[appearance]
  }
  const accent = [accents.dark, accents.light].find(isStringValue)

  return {
    light: variant("light"),
    dark: variant("dark"),
    accent: accent ? normalizeThemeColor(accent) : null,
  }
}
