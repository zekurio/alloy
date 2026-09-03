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

export const DEFAULT_THEME_PRESET_ID = DEFAULT_THEME_PALETTE_ID

export const DARK_THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: DEFAULT_THEME_PRESET_ID,
    label: "Alloy",
    // Mirrors the `:root, .dark` defaults in globals.css.
    tokens: {
      neutrals: [
        "oklch(0.11 0 0)",
        "oklch(0.15 0 0)",
        "oklch(0.19 0 0)",
        "oklch(0.235 0 0)",
        "oklch(0.27 0 0)",
        "oklch(0.34 0 0)",
        "oklch(0.45 0 0)",
        "oklch(0.57 0 0)",
        "oklch(0.68 0 0)",
        "oklch(0.79 0 0)",
        "oklch(0.9 0 0)",
        "oklch(0.98 0 0)",
      ],
      surfaceSunken: "oklch(0.07 0 0)",
      foregroundFaint: "oklch(0.63 0 0)",
      accent: "#d0c4eb",
      accentHover: "#e3daf5",
      accentActive: "#b3a8cf",
      accentForeground: "#0b0a0f",
      accentDim: "#5d5572",
      success: "oklch(0.72 0.19 145)",
      warning: "oklch(0.82 0.18 90)",
      danger: "oklch(0.65 0.24 25)",
      info: "oklch(0.72 0.15 230)",
      live: "oklch(0.65 0.25 25)",
    },
  },
  {
    id: "catppuccin-frappe",
    label: "Catppuccin Frappé",
    tokens: {
      neutrals: [
        "#303446",
        "#383c50",
        "#414559",
        "#494e64",
        "#51576d",
        "#626880",
        "#737994",
        "#838ba7",
        "#949cbb",
        "#a5adce",
        "#b5bfe2",
        "#c6d0f5",
      ],
      surfaceSunken: "#232634",
      foregroundFaint: "#8b93b1",
      accent: "#ca9ee6",
      accentHover: "#d9b6ee",
      accentActive: "#b184d6",
      accentForeground: "#232634",
      accentDim: "#75618f",
      success: "#a6d189",
      warning: "#e5c890",
      danger: "#e78284",
      info: "#8caaee",
      live: "#e78284",
    },
  },
  {
    id: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    tokens: {
      neutrals: [
        "#24273a",
        "#2d3044",
        "#363a4f",
        "#404459",
        "#494d64",
        "#5b6078",
        "#6e738d",
        "#8087a2",
        "#939ab7",
        "#a5adcb",
        "#b8c0e0",
        "#cad3f5",
      ],
      surfaceSunken: "#181926",
      foregroundFaint: "#878da6",
      accent: "#c6a0f6",
      accentHover: "#d4b6f8",
      accentActive: "#ad88d9",
      accentForeground: "#181926",
      accentDim: "#72608f",
      success: "#a6da95",
      warning: "#eed49f",
      danger: "#ed8796",
      info: "#8aadf4",
      live: "#ed8796",
    },
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    tokens: {
      neutrals: [
        "#1e1e2e",
        "#272839",
        "#313244",
        "#3b3c50",
        "#45475a",
        "#585b70",
        "#6c7086",
        "#7f849c",
        "#9399b2",
        "#a6adc8",
        "#bac2de",
        "#cdd6f4",
      ],
      surfaceSunken: "#11111b",
      foregroundFaint: "#898ea9",
      accent: "#cba6f7",
      accentHover: "#dabcf9",
      accentActive: "#b28ede",
      accentForeground: "#11111b",
      accentDim: "#74618f",
      success: "#a6e3a1",
      warning: "#f9e2af",
      danger: "#f38ba8",
      info: "#89b4fa",
      live: "#f38ba8",
    },
  },
  {
    id: "nord",
    label: "Nord",
    tokens: {
      neutrals: [
        "#2e3440",
        "#343b49",
        "#3b4252",
        "#434c5e",
        "#4c566a",
        "#616e88",
        "#7b88a1",
        "#8b97ad",
        "#a4b0c4",
        "#c8d0dd",
        "#d8dee9",
        "#eceff4",
      ],
      surfaceSunken: "#272c36",
      foregroundFaint: "#96a2b6",
      accent: "#88c0d0",
      accentHover: "#9ed0dd",
      accentActive: "#75aebf",
      accentForeground: "#2e3440",
      accentDim: "#4f6d77",
      success: "#a3be8c",
      warning: "#ebcb8b",
      danger: "#bf616a",
      info: "#81a1c1",
      live: "#bf616a",
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    tokens: {
      neutrals: [
        "#282c34",
        "#2c313a",
        "#333842",
        "#3a3f4b",
        "#424957",
        "#4d5464",
        "#5c6370",
        "#6e7687",
        "#848c9e",
        "#9da5b4",
        "#abb2bf",
        "#d7dae0",
      ],
      surfaceSunken: "#21252b",
      foregroundFaint: "#7a8294",
      accent: "#61afef",
      accentHover: "#83c0f4",
      accentActive: "#4d9ddb",
      accentForeground: "#1b2028",
      accentDim: "#3d5a78",
      success: "#98c379",
      warning: "#e5c07b",
      danger: "#e06c75",
      info: "#56b6c2",
      live: "#e06c75",
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    tokens: {
      neutrals: [
        "#191724",
        "#1f1d2e",
        "#26233a",
        "#322f46",
        "#403d52",
        "#524f67",
        "#6e6a86",
        "#7e7a97",
        "#908caa",
        "#aeaac5",
        "#c7c4dd",
        "#e0def4",
      ],
      surfaceSunken: "#16141f",
      foregroundFaint: "#86829f",
      accent: "#c4a7e7",
      accentHover: "#d3bcee",
      accentActive: "#b192da",
      accentForeground: "#191724",
      accentDim: "#6a5c8a",
      // Rosé Pine has no green: foam stands in for success, the brighter
      // Moon-variant pine for info, per common ports of the palette.
      success: "#9ccfd8",
      warning: "#f6c177",
      danger: "#eb6f92",
      info: "#3e8fb0",
      live: "#eb6f92",
    },
  },
  {
    id: "rose-pine-moon",
    label: "Rosé Pine Moon",
    tokens: {
      neutrals: [
        "#232136",
        "#2a273f",
        "#393552",
        "#3f3c53",
        "#44415a",
        "#56526e",
        "#6e6a86",
        "#7e7a97",
        "#908caa",
        "#aeaac5",
        "#c7c4dd",
        "#e0def4",
      ],
      surfaceSunken: "#1e1b2e",
      foregroundFaint: "#86829f",
      accent: "#c4a7e7",
      accentHover: "#d3bcee",
      accentActive: "#b192da",
      accentForeground: "#232136",
      accentDim: "#6a5c8a",
      success: "#9ccfd8",
      warning: "#f6c177",
      danger: "#eb6f92",
      info: "#3e8fb0",
      live: "#eb6f92",
    },
  },
]

export const LIGHT_THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: DEFAULT_THEME_PRESET_ID,
    label: "Alloy",
    // Mirrors the `:root.light` overrides in globals.css (plus the status
    // colors light mode inherits from the dark defaults).
    tokens: {
      neutrals: [
        "oklch(0.99 0 0)",
        "oklch(0.975 0 0)",
        "oklch(0.96 0 0)",
        "oklch(0.94 0 0)",
        "oklch(0.9 0 0)",
        "oklch(0.84 0 0)",
        "oklch(0.7 0 0)",
        "oklch(0.6 0 0)",
        "oklch(0.5 0 0)",
        "oklch(0.4 0 0)",
        "oklch(0.3 0 0)",
        "oklch(0.2 0 0)",
      ],
      surfaceSunken: "oklch(0.94 0 0)",
      foregroundFaint: "oklch(0.5 0 0)",
      accent: "#5d4f96",
      accentHover: "#4d4180",
      accentActive: "#6e5fad",
      accentForeground: "#ffffff",
      accentDim: "#b3a8cf",
      success: "oklch(0.72 0.19 145)",
      warning: "oklch(0.62 0.15 75)",
      danger: "oklch(0.65 0.24 25)",
      info: "oklch(0.72 0.15 230)",
      live: "oklch(0.65 0.25 25)",
    },
  },
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    tokens: {
      neutrals: [
        "#eff1f5",
        "#e6e9ef",
        "#dce0e8",
        "#d5d8e1",
        "#ccd0da",
        "#bcc0cc",
        "#9ca0b0",
        "#8c8fa1",
        "#7c7f93",
        "#6c6f85",
        "#5c5f77",
        "#4c4f69",
      ],
      surfaceSunken: "#dce0e8",
      foregroundFaint: "#8c8fa1",
      accent: "#8839ef",
      accentHover: "#7326d3",
      accentActive: "#9a55f3",
      accentForeground: "#ffffff",
      accentDim: "#cdb0f7",
      success: "#40a02b",
      warning: "#df8e1d",
      danger: "#d20f39",
      info: "#1e66f5",
      live: "#d20f39",
    },
  },
  {
    id: "nord-light",
    label: "Nord Light",
    tokens: {
      neutrals: [
        "#eceff4",
        "#e5e9f0",
        "#d8dee9",
        "#cfd7e3",
        "#c2ccd9",
        "#adbacb",
        "#8291a9",
        "#6d7d96",
        "#5d6b83",
        "#4c566a",
        "#434c5e",
        "#2e3440",
      ],
      surfaceSunken: "#d8dee9",
      foregroundFaint: "#6d7d96",
      accent: "#5e81ac",
      accentHover: "#4e6f96",
      accentActive: "#6f92bd",
      accentForeground: "#ffffff",
      accentDim: "#b7c8dc",
      // Aurora colors darkened for legibility on the Snow Storm background.
      success: "#6d8a4e",
      warning: "#b08339",
      danger: "#a34b55",
      info: "#527299",
      live: "#a34b55",
    },
  },
  {
    id: "one-light",
    label: "One Light",
    tokens: {
      neutrals: [
        "#fafafa",
        "#f2f2f3",
        "#eaeaeb",
        "#e2e2e4",
        "#d7d7da",
        "#c5c5c9",
        "#a0a1a7",
        "#8f9096",
        "#696c77",
        "#565962",
        "#464951",
        "#383a42",
      ],
      surfaceSunken: "#eaeaeb",
      foregroundFaint: "#8f9096",
      accent: "#4078f2",
      accentHover: "#2e63d8",
      accentActive: "#5b8af4",
      accentForeground: "#ffffff",
      accentDim: "#b1c7f8",
      success: "#50a14f",
      warning: "#986801",
      danger: "#e45649",
      info: "#0184bc",
      live: "#e45649",
    },
  },
  {
    id: "rose-pine-dawn",
    label: "Rosé Pine Dawn",
    tokens: {
      neutrals: [
        "#faf4ed",
        "#f4ede8",
        "#f2e9e1",
        "#eae0d8",
        "#dfdad9",
        "#cecacd",
        "#9893a5",
        "#8b869d",
        "#797593",
        "#6e6a87",
        "#625d80",
        "#575279",
      ],
      surfaceSunken: "#efe6dd",
      foregroundFaint: "#8b869d",
      accent: "#907aa9",
      accentHover: "#7e6894",
      accentActive: "#a18bbd",
      accentForeground: "#ffffff",
      accentDim: "#cfc3dd",
      success: "#56949f",
      warning: "#ea9d34",
      danger: "#b4637a",
      info: "#286983",
      live: "#b4637a",
    },
  },
]

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

export function getStoredThemePalette(): ThemePalette {
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

// Matches the alpha ramps globals.css uses for the default accents.
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

export function themeTokenDeclarations(
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
