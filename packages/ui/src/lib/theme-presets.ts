import {
  DEFAULT_THEME_PALETTE_ID,
  readThemePreferences,
  type ThemeAppearance,
  type ThemePaletteId,
  type ThemeVariants,
  writeThemePreferences,
} from "@alloy/ui/lib/theme-storage"
import {
  THEME_ACCENT_STYLE_ID,
  THEME_PRESET_STYLE_ID,
} from "@alloy/ui/lib/theme-style"

import { DARK_THEME_PRESETS } from "./theme-presets-dark"
import { LIGHT_THEME_PRESETS } from "./theme-presets-light"

/**
 * Bundled palette presets for the theme selector, split into dark and light
 * families so each mode can carry its own palette (e.g. Catppuccin Frappé in
 * dark, Latte in light). A palette can also offer variant presets per
 * appearance, like Catppuccin's Macchiato and Mocha dark flavours.
 *
 * Every preset restates the same fixed token set, and the generated CSS uses
 * the base stylesheet's own selector structure — `:root, .dark` for the dark
 * palette and `:root.light` for the light one. That keeps the cascade
 * identical to `globals.css`: the light block always beats the dark `:root`
 * block on specificity, and a forced-dark subtree (`.dark` under a light
 * root) keeps the chosen dark palette.
 */

export type ThemePresetMode = ThemeAppearance

export interface ThemePreset {
  id: string
  /** Palette names are proper nouns and intentionally untranslated. */
  label: string
  tokens: ThemePresetTokens
}

/** A first-class theme owns both appearances as one coherent choice. */
export interface ThemePalette {
  id: ThemePaletteId
  label: string
  dark: ThemePreset
  light: ThemePreset
  /**
   * Alternative presets selectable per appearance (e.g. Catppuccin's dark
   * flavours). Excludes the defaults above.
   */
  variants?: Partial<Record<ThemePresetMode, readonly ThemePreset[]>>
}

/** Values for `--neutral-0` … `--neutral-900`, background to strongest text. */
type NeutralRamp = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]

export interface ThemePresetTokens {
  neutrals: NeutralRamp
  surfaceSunken: string
  foregroundFaint: string
  /** Solid `#rrggbb`; the translucent accent variants are derived from it. */
  accent: string
  accentHover: string
  accentActive: string
  accentForeground: string
  /** Optional generated soft fill when the standard mode alpha is unsafe. */
  accentSoft?: string
  accentDim: string
  success: string
  successSoft?: string
  warning: string
  warningSoft?: string
  danger: string
  dangerSoft?: string
  info: string
  infoSoft?: string
  live: string
  liveSoft?: string
}

const DEFAULT_THEME_PRESET_ID = DEFAULT_THEME_PALETTE_ID

export const THEME_PALETTES: readonly ThemePalette[] = [
  pairTheme("default", "Alloy", "default", "default"),
  pairTheme(
    "catppuccin",
    "Catppuccin",
    "catppuccin-frappe",
    "catppuccin-latte",
    {
      dark: [
        presetById("dark", "catppuccin-macchiato"),
        presetById("dark", "catppuccin-mocha"),
      ],
    },
  ),
  pairTheme("nord", "Nord", "nord", "nord-light"),
  pairTheme("one", "One", "one-dark", "one-light"),
  pairTheme("rose-pine", "Rosé Pine", "rose-pine", "rose-pine-dawn", {
    dark: [presetById("dark", "rose-pine-moon")],
  }),
  pairTheme("gruvbox", "Gruvbox", "gruvbox-dark", "gruvbox-light"),
]

/** Default preset first, then any variant presets for that appearance. */
export function themePalettePresets(
  palette: ThemePalette,
  mode: ThemePresetMode,
): readonly ThemePreset[] {
  return [palette[mode], ...(palette.variants?.[mode] ?? [])]
}

/** Applies the stored variant choice, falling back to the palette default. */
export function resolveThemePreset(
  palette: ThemePalette,
  mode: ThemePresetMode,
  variants: ThemeVariants,
): ThemePreset {
  const selected = variants[mode]
  return (
    themePalettePresets(palette, mode).find(
      (preset) => preset.id === selected,
    ) ?? palette[mode]
  )
}

export function getStoredThemeVariants(): ThemeVariants {
  return readThemePreferences().variants
}

/** The active preset for one appearance, variants included. */
export function getStoredThemePreset(mode: ThemePresetMode): ThemePreset {
  return resolveThemePreset(
    getStoredThemePalette(),
    mode,
    readThemePreferences().variants,
  )
}

export function setStoredThemeVariant(
  mode: ThemePresetMode,
  presetId: string,
): void {
  const palette = getStoredThemePalette()
  const preset = themePalettePresets(palette, mode).find(
    (candidate) => candidate.id === presetId,
  )
  if (!preset) return

  const preferences = readThemePreferences()
  const variants = { ...preferences.variants }
  // Selecting the palette default clears the override instead of storing it.
  if (preset.id === palette[mode].id) delete variants[mode]
  else variants[mode] = preset.id
  writeThemePreferences({ ...preferences, variants })
  applyThemePalette(palette)
}

export function getStoredThemePaletteId(): ThemePaletteId {
  return readThemePreferences().palette
}

export function setStoredThemePalette(id: string): void {
  const palette = THEME_PALETTES.find((candidate) => candidate.id === id)
  if (!palette) return

  const preferences = readThemePreferences()
  writeThemePreferences({ ...preferences, palette: palette.id })
  applyThemePalette(palette)
}

function getStoredThemePalette(): ThemePalette {
  return paletteById(getStoredThemePaletteId())
}

function pairTheme(
  id: ThemePaletteId,
  label: string,
  darkId: string,
  lightId: string,
  variants?: ThemePalette["variants"],
): ThemePalette {
  return {
    id,
    label,
    dark: presetById("dark", darkId),
    light: presetById("light", lightId),
    variants,
  }
}

/** Writes both appearances into one preset style element. */
export function applyStoredThemePresets(): void {
  applyThemePalette(getStoredThemePalette())
}

function removeThemePresetStyle(): void {
  if (!globalThis.document) return
  document.getElementById(THEME_PRESET_STYLE_ID)?.remove()
}

function applyThemePalette(palette: ThemePalette): void {
  if (!globalThis.document) return

  const storedVariants = readThemePreferences().variants
  const dark = resolveThemePreset(palette, "dark", storedVariants)
  const light = resolveThemePreset(palette, "light", storedVariants)
  const existing = document.getElementById(THEME_PRESET_STYLE_ID)

  // Both defaults means the bundled stylesheet already has it exactly right.
  if (
    dark.id === DEFAULT_THEME_PRESET_ID &&
    light.id === DEFAULT_THEME_PRESET_ID
  ) {
    removeThemePresetStyle()
    return
  }

  const css = `:root,\n.dark {\n${themeTokenDeclarations(dark.tokens, "dark")}\n}\n\n:root.light {\n${themeTokenDeclarations(light.tokens, "light")}\n}\n`
  const style =
    existing instanceof HTMLStyleElement
      ? existing
      : document.createElement("style")
  style.id = THEME_PRESET_STYLE_ID
  if (style.textContent !== css) style.textContent = css

  const nextLayer = document.getElementById(THEME_ACCENT_STYLE_ID)
  if (nextLayer) {
    document.head.insertBefore(style, nextLayer)
    return
  }
  if (!style.isConnected) document.head.append(style)
}

function paletteById(id: string): ThemePalette {
  return (
    THEME_PALETTES.find((palette) => palette.id === id) ?? THEME_PALETTES[0]!
  )
}

function presetById(mode: ThemePresetMode, id: string): ThemePreset {
  const presets = mode === "dark" ? DARK_THEME_PRESETS : LIGHT_THEME_PRESETS
  return presets.find((preset) => preset.id === id) ?? presets[0]!
}

const NEUTRAL_STEPS = [
  "0",
  "50",
  "100",
  "150",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
] as const

interface AccentAlphas {
  soft: number
  border: number
  glow: number
}

// Keep these alpha values in sync with globals.css.
const DARK_ACCENT_ALPHAS: AccentAlphas = {
  soft: 0.22,
  border: 0.55,
  glow: 0.38,
}
const LIGHT_ACCENT_ALPHAS: AccentAlphas = {
  soft: 0.12,
  border: 0.4,
  glow: 0.28,
}

function themeTokenDeclarations(
  tokens: ThemePresetTokens,
  mode: ThemePresetMode,
): string {
  const alphas = mode === "dark" ? DARK_ACCENT_ALPHAS : LIGHT_ACCENT_ALPHAS
  const lines = [
    ...NEUTRAL_STEPS.map(
      (step, index) => `--neutral-${step}: ${tokens.neutrals[index]};`,
    ),
    `--surface-sunken: ${tokens.surfaceSunken};`,
    `--foreground-faint: ${tokens.foregroundFaint};`,
    `--primary: ${tokens.accent};`,
    `--primary-foreground: ${tokens.accentForeground};`,
    `--accent: ${tokens.accent};`,
    `--accent-hover: ${tokens.accentHover};`,
    `--accent-active: ${tokens.accentActive};`,
    `--accent-foreground: ${tokens.accentForeground};`,
    `--accent-soft: ${tokens.accentSoft ?? accentAlpha(tokens.accent, alphas.soft)};`,
    `--accent-border: ${accentAlpha(tokens.accent, alphas.border)};`,
    `--accent-glow: ${accentAlpha(tokens.accent, alphas.glow)};`,
    `--accent-dim: ${tokens.accentDim};`,
    `--success: ${tokens.success};`,
    `--success-soft: ${tokens.successSoft ?? statusSoft(tokens.success)};`,
    `--warning: ${tokens.warning};`,
    `--warning-soft: ${tokens.warningSoft ?? statusSoft(tokens.warning)};`,
    `--danger: ${tokens.danger};`,
    `--danger-soft: ${tokens.dangerSoft ?? statusSoft(tokens.danger)};`,
    `--destructive: ${tokens.danger};`,
    `--info: ${tokens.info};`,
    `--info-soft: ${tokens.infoSoft ?? statusSoft(tokens.info)};`,
    `--live: ${tokens.live};`,
    `--live-soft: ${tokens.liveSoft ?? statusSoft(tokens.live)};`,
  ]
  return lines.map((line) => `  ${line}`).join("\n")
}

function statusSoft(color: string): string {
  return `color-mix(in srgb, ${color} 12%, transparent)`
}

function accentAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
