import {
  isObjectRecord,
  isStringValue,
  THEME_MODES,
  type ContractJsonInput,
  type SyncedThemePreferences,
} from "@alloy/contracts"
import { createLocalStorageDriver } from "@alloy/ui/lib/local-storage"
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

export function normalizeThemePreferences(
  value: ContractJsonInput,
): ThemePreferences {
  if (!isObjectRecord(value)) return { ...DEFAULT_THEME_PREFERENCES }

  const mode =
    THEME_MODES.find((candidate) => candidate === value.mode) ??
    DEFAULT_THEME_PREFERENCES.mode
  const sync = value.sync !== false

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
