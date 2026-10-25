import type { ThemeAppearance, ThemeColors } from "@alloy/ui/lib/theme-colors"

import { DARK_THEME_VARIANTS } from "./theme-presets-dark"
import { LIGHT_THEME_VARIANTS } from "./theme-presets-light"

/**
 * Bundled themes. A theme groups the variants that belong together — a light
 * and one or more dark palettes — and each appearance picks one variant on
 * its own, so light can come from one theme and dark from another.
 */

export interface ThemeVariant {
  id: string
  /** Base theme names are marked for translation; palette names are proper nouns. */
  label: string
  appearance: ThemeAppearance
  colors: ThemeColors
}

export interface ThemeFamily {
  id: string
  label: string
  /** The first variant of each appearance is the one a whole-theme pick uses. */
  variants: readonly ThemeVariant[]
  /** Takes the server's (or the user's) accent instead of its own. */
  followsAccent: boolean
  /** Made or imported by the user rather than bundled. */
  custom: boolean
}

export const ALLOY_THEME_ID = "alloy"

export const DEFAULT_THEME_VARIANT_IDS = {
  light: "alloy-light",
  dark: "alloy-dark",
} as const satisfies Record<ThemeAppearance, string>

const PRESET_VARIANTS = [...LIGHT_THEME_VARIANTS, ...DARK_THEME_VARIANTS]

/** The monochrome bases, in the order the base theme picker shows them. */
export const BASE_THEME_VARIANTS: readonly ThemeVariant[] = [
  "alloy-dark",
  "alloy-dim",
  "alloy-black",
  "alloy-light",
].map(presetVariant)

export const BUILTIN_THEMES: readonly ThemeFamily[] = [
  builtinTheme(ALLOY_THEME_ID, "Alloy", [
    "alloy-light",
    "alloy-dark",
    "alloy-dim",
    "alloy-black",
  ]),
  builtinTheme("catppuccin", "Catppuccin", [
    "catppuccin-latte",
    "catppuccin-frappe",
    "catppuccin-macchiato",
    "catppuccin-mocha",
  ]),
  builtinTheme("nord", "Nord", ["nord-light", "nord"]),
  builtinTheme("one", "One", ["one-light", "one-dark"]),
  builtinTheme("rose-pine", "Rosé Pine", [
    "rose-pine-dawn",
    "rose-pine",
    "rose-pine-moon",
  ]),
  builtinTheme("gruvbox", "Gruvbox", ["gruvbox-light", "gruvbox-dark"]),
]

export function isBaseThemeVariant(id: string): boolean {
  return BASE_THEME_VARIANTS.some((variant) => variant.id === id)
}

/** The variant a whole-theme pick assigns to `appearance`, if it has one. */
export function themeFamilyDefault(
  family: ThemeFamily,
  appearance: ThemeAppearance,
): ThemeVariant | undefined {
  return family.variants.find((variant) => variant.appearance === appearance)
}

function builtinTheme(
  id: string,
  label: string,
  variantIds: readonly string[],
): ThemeFamily {
  return {
    id,
    label,
    variants: variantIds.map(presetVariant),
    followsAccent: id === ALLOY_THEME_ID,
    custom: false,
  }
}

function presetVariant(id: string): ThemeVariant {
  const variant = PRESET_VARIANTS.find((candidate) => candidate.id === id)
  if (!variant) throw new Error(`Unknown theme preset: ${id}`)
  return variant
}
