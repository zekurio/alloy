import {
  isObjectRecord,
  isStringValue,
  THEME_MODES,
  type ContractJsonInput,
  type ContractJsonValue,
  type SyncedThemePreferences,
} from "@alloy/contracts"
import { createLocalStorageDriver } from "@alloy/ui/lib/local-storage"
import type { ThemeAppearance } from "@alloy/ui/lib/theme-colors"
import { DEFAULT_THEME_VARIANT_IDS } from "@alloy/ui/lib/theme-presets"

/** Keep in sync with the pre-paint script in packages/web/index.html. */
export const THEME_STORAGE_KEY = "alloy.theme"

/**
 * The synced choice (mode, and a variant id per appearance where unknown ids
 * fall back to Alloy), plus whether this device shares it with the account.
 */
export interface ThemePreferences extends SyncedThemePreferences {
  /** Device-local: never sent to the account. */
  sync: boolean
}

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  mode: "system",
  light: DEFAULT_THEME_VARIANT_IDS.light,
  dark: DEFAULT_THEME_VARIANT_IDS.dark,
  sync: true,
}

/**
 * Default variants of the palettes the first theme picker stored as
 * `{ palette, variants, accents }`, so existing choices carry over. Accents
 * aren't kept; a theme's accent is now edited in the theme itself.
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
  const sync = value.sync !== false
  if (!isStringValue(value.light) && isStringValue(value.palette)) {
    return { mode, sync, ...migrateLegacyPreferences(value) }
  }

  return {
    mode,
    light: isStringValue(value.light)
      ? value.light
      : DEFAULT_THEME_PREFERENCES.light,
    dark: isStringValue(value.dark)
      ? value.dark
      : DEFAULT_THEME_PREFERENCES.dark,
    sync,
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
): Omit<ThemePreferences, "mode" | "sync"> {
  const palette =
    LEGACY_PALETTES.find((entry) => entry.palette === value.palette) ??
    DEFAULT_THEME_VARIANT_IDS
  const variants = isObjectRecord(value.variants) ? value.variants : {}
  // The old default preset id was shared by both appearances.
  const variant = (appearance: ThemeAppearance) => {
    const stored = variants[appearance]
    return isStringValue(stored) && stored !== "default"
      ? stored
      : palette[appearance]
  }
  return { light: variant("light"), dark: variant("dark") }
}
