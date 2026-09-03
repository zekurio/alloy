import {
  isObjectRecord,
  isStringValue,
  type ContractJsonInput,
} from "@alloy/contracts"
import { formatCssColor, parseCssColor } from "@alloy/ui/lib/color"
import { createLocalStorageDriver } from "@alloy/ui/lib/local-storage"

export const THEME_STORAGE_KEY = "alloy.theme"

export const THEMES = ["system", "light", "dark"] as const
export type Theme = (typeof THEMES)[number]
export const DEFAULT_THEME: Theme = "system"

export const THEME_PALETTE_IDS = [
  "default",
  "catppuccin",
  "nord",
  "one",
  "rose-pine",
] as const
export type ThemePaletteId = (typeof THEME_PALETTE_IDS)[number]
export const DEFAULT_THEME_PALETTE_ID: ThemePaletteId = "default"

export type ThemeAppearance = "dark" | "light"
export type ThemeAccents = Partial<Record<ThemeAppearance, string>>
/** Selected preset ids per appearance for the active palette. */
export type ThemeVariants = Partial<Record<ThemeAppearance, string>>

export interface ThemePreferences {
  mode: Theme
  palette: ThemePaletteId
  variants: ThemeVariants
  accents: ThemeAccents
}

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  mode: DEFAULT_THEME,
  palette: DEFAULT_THEME_PALETTE_ID,
  variants: {},
  accents: {},
}

export function normalizeThemePreferences(
  value: ContractJsonInput,
): ThemePreferences {
  if (!isObjectRecord(value)) {
    return { ...DEFAULT_THEME_PREFERENCES, accents: {} }
  }

  return {
    mode: THEMES.find((candidate) => candidate === value.mode) ?? DEFAULT_THEME,
    palette:
      THEME_PALETTE_IDS.find((candidate) => candidate === value.palette) ??
      DEFAULT_THEME_PALETTE_ID,
    variants: normalizeThemeVariants(value.variants),
    accents: normalizeThemeAccents(value.accents),
  }
}

export function normalizeThemeAccent(value: string): string | null {
  const color = parseCssColor(value)
  if (!color) return null
  return formatCssColor({ ...color, a: 1 })
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

function normalizeThemeVariants(value: ContractJsonInput): ThemeVariants {
  if (!isObjectRecord(value)) return {}

  // Preset ids resolve against the active palette at apply time; unknown ids
  // fall back to the palette default, so any string is safe to keep here.
  const dark = isStringValue(value.dark) ? value.dark : null
  const light = isStringValue(value.light) ? value.light : null
  return dark && light
    ? { dark, light }
    : dark
      ? { dark }
      : light
        ? { light }
        : {}
}

function normalizeThemeAccents(value: ContractJsonInput): ThemeAccents {
  if (!isObjectRecord(value)) return {}

  const dark = isStringValue(value.dark)
    ? normalizeThemeAccent(value.dark)
    : null
  const light = isStringValue(value.light)
    ? normalizeThemeAccent(value.light)
    : null
  return dark && light
    ? { dark, light }
    : dark
      ? { dark }
      : light
        ? { light }
        : {}
}
