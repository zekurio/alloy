import { t } from "@alloy/contracts/schema"
import { formatCssColor, parseCssColor, type Rgba } from "@alloy/ui/lib/color"
import {
  getStoredThemePalette,
  themeTokenDeclarations,
  type ThemePresetMode,
  type ThemePresetTokens,
} from "@alloy/ui/lib/theme-presets"
import { THEME_CUSTOMIZATION_STYLE_ID } from "@alloy/ui/lib/theme-style"

export const THEME_CUSTOMIZATION_STORAGE_KEY = "alloy.themeColors"

export const THEME_COLOR_ROLES = [
  "background",
  "surface",
  "surfaceRaised",
  "surfaceSunken",
  "text",
  "textMuted",
  "input",
  "border",
  "accent",
  "success",
  "warning",
  "danger",
  "info",
  "live",
] as const

export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number]
export type ThemeColors = Record<ThemeColorRole, string>

export interface ThemePaletteCustomization {
  /** Guided palettes derive every role from background and accent. */
  advanced: boolean
  colors: ThemeColors
}

export interface ThemeCustomizationState {
  /** One personal accent can retint any built-in or generated theme. */
  accent: string | null
  palettes: Partial<Record<ThemePresetMode, ThemePaletteCustomization>>
}

export const DEFAULT_THEME_CUSTOMIZATION: ThemeCustomizationState = {
  accent: null,
  palettes: {},
}

let sessionThemeCustomization: ThemeCustomizationState | null = null

export function readThemeCustomization(): ThemeCustomizationState {
  if (sessionThemeCustomization) return sessionThemeCustomization
  if (!globalThis.window) return DEFAULT_THEME_CUSTOMIZATION

  try {
    const stored = window.localStorage.getItem(THEME_CUSTOMIZATION_STORAGE_KEY)
    if (!stored) return DEFAULT_THEME_CUSTOMIZATION
    const parsed = StoredThemeCustomizationSchema.safeParse(JSON.parse(stored))
    return parsed.success
      ? normalizeThemeCustomization(parsed.data)
      : DEFAULT_THEME_CUSTOMIZATION
  } catch {
    return DEFAULT_THEME_CUSTOMIZATION
  }
}

export function writeThemeCustomization(state: ThemeCustomizationState): void {
  if (!globalThis.window) return
  try {
    window.localStorage.setItem(
      THEME_CUSTOMIZATION_STORAGE_KEY,
      JSON.stringify(state),
    )
    sessionThemeCustomization = null
  } catch {
    sessionThemeCustomization = state
  }
  applyThemeCustomization(state)
}

export function applyStoredThemeCustomization(): void {
  applyThemeCustomization(readThemeCustomization())
}

export function applyThemeCustomization(state: ThemeCustomizationState): void {
  if (!globalThis.document) return

  const existing = document.getElementById(THEME_CUSTOMIZATION_STYLE_ID)
  const storedPalette = getStoredThemePalette()
  const sections = (["dark", "light"] as const).flatMap((mode) => {
    const palette = state.palettes[mode]
    if (!palette && !state.accent) return []
    const selector = mode === "dark" ? ":root,\n.dark" : ":root.light"
    const declarations = palette
      ? themeTokenDeclarations(
          themeColorsToTokens(
            state.accent
              ? { ...palette.colors, accent: state.accent }
              : palette.colors,
          ),
          mode,
        )
      : accentTokenDeclarations(
          state.accent ?? DARK_FALLBACK.accent,
          storedPalette[mode].tokens.neutrals[0],
          mode,
        )
    return `${selector} {\n${declarations}\n}`
  })

  if (sections.length === 0) {
    existing?.remove()
    return
  }

  const css = `${sections.join("\n\n")}\n`
  const style =
    existing instanceof HTMLStyleElement
      ? existing
      : document.createElement("style")
  style.id = THEME_CUSTOMIZATION_STYLE_ID
  if (style.textContent !== css) style.textContent = css

  // Personal colors are the final theme layer. Appending an existing node also
  // restores that ordering after the server's instance CSS changes at runtime.
  document.head.append(style)
}

/** Converts a picker-compatible CSS color into the opaque hex stored by themes. */
export function themeColorToHex(value: string): string | null {
  const color = parseCssColor(value)
  if (!color) return null
  return formatCssColor({ ...color, a: 1 })
}

/** High-level editable roles represented by one of the hand-tuned presets. */
export function themeColorsFromTokens(
  tokens: ThemePresetTokens,
  mode: ThemePresetMode,
) {
  const fallback = mode === "dark" ? DARK_FALLBACK : LIGHT_FALLBACK
  const color = (value: string, role: ThemeColorRole) =>
    themeColorToHex(value) ?? fallback[role]

  return {
    background: color(tokens.neutrals[0], "background"),
    surface: color(tokens.neutrals[1], "surface"),
    surfaceRaised: color(tokens.neutrals[2], "surfaceRaised"),
    surfaceSunken: color(tokens.surfaceSunken, "surfaceSunken"),
    text: color(tokens.neutrals[11], "text"),
    textMuted: color(tokens.neutrals[9], "textMuted"),
    input: color(tokens.neutrals[3], "input"),
    border: color(tokens.neutrals[4], "border"),
    accent: color(tokens.accent, "accent"),
    success: color(tokens.success, "success"),
    warning: color(tokens.warning, "warning"),
    danger: color(tokens.danger, "danger"),
    info: color(tokens.info, "info"),
    live: color(tokens.live, "live"),
  } satisfies ThemeColors
}

/**
 * Generates a coherent palette from two seed colors. Surfaces use a perceptual
 * OKLab ramp, foregrounds are contrast-aware, and status colors stay
 * semantic instead of being recolored to match the accent.
 */
export function createGuidedThemeColors(
  mode: ThemePresetMode,
  background: string,
  accent: string,
  base?: ThemeColors,
) {
  const fallback = mode === "dark" ? DARK_FALLBACK : LIGHT_FALLBACK
  const backgroundColor = requireColor(background, fallback.background)
  const accentColor = requireColor(accent, fallback.accent)
  const dark = relativeLuminance(backgroundColor) < 0.179
  const textColor = readableForeground(backgroundColor)
  const surfaceDirection = textColor
  const surface = mixColor(
    mixColor(backgroundColor, surfaceDirection, dark ? 0.055 : 0.018),
    accentColor,
    dark ? 0.025 : 0.012,
  )
  const surfaceRaised = mixColor(
    mixColor(backgroundColor, surfaceDirection, dark ? 0.095 : 0.04),
    accentColor,
    dark ? 0.03 : 0.015,
  )
  const input = mixColor(
    mixColor(backgroundColor, surfaceDirection, dark ? 0.145 : 0.075),
    accentColor,
    dark ? 0.035 : 0.018,
  )
  const border = mixColor(
    mixColor(backgroundColor, surfaceDirection, dark ? 0.19 : 0.115),
    accentColor,
    dark ? 0.045 : 0.022,
  )
  const status = base ?? fallback

  return {
    background: colorHex(backgroundColor),
    surface: colorHex(surface),
    surfaceRaised: colorHex(surfaceRaised),
    surfaceSunken: colorHex(
      mixColor(backgroundColor, dark ? BLACK : textColor, dark ? 0.3 : 0.055),
    ),
    text: colorHex(textColor),
    // Alloy has both dim and muted text below this anchor; leave enough
    // contrast headroom for the generated dim step to remain readable.
    textMuted: colorHex(quietForeground(backgroundColor, textColor, 6)),
    input: colorHex(input),
    border: colorHex(border),
    accent: colorHex(accentColor),
    success: status.success,
    warning: status.warning,
    danger: status.danger,
    info: status.info,
    live: status.live,
  } satisfies ThemeColors
}

export function themeColorsToTokens(colors: ThemeColors): ThemePresetTokens {
  const background = requireColor(colors.background, DARK_FALLBACK.background)
  const surface = requireColor(colors.surface, colors.background)
  const raised = requireColor(colors.surfaceRaised, colors.surface)
  const input = requireColor(colors.input, colors.surfaceRaised)
  const border = requireColor(colors.border, colors.input)
  const muted = requireColor(colors.textMuted, colors.text)
  const text = requireColor(colors.text, DARK_FALLBACK.text)
  const accent = createAccentColors(colors.accent, background)
  const dark = relativeLuminance(background) < 0.179
  const status = (value: string, fallback: string) => {
    const base = ensureTintedContrast(
      requireColor(value, fallback),
      background,
      0.12,
      4.55,
    )
    return {
      base: colorHex(base),
      soft: colorAlpha(
        base,
        contrastSafeTintAlpha(base, background, 0.12, 4.55),
      ),
    }
  }
  const success = status(colors.success, DARK_FALLBACK.success)
  const warning = status(colors.warning, DARK_FALLBACK.warning)
  const danger = status(colors.danger, DARK_FALLBACK.danger)
  const info = status(colors.info, DARK_FALLBACK.info)
  const live = status(colors.live, DARK_FALLBACK.live)

  return {
    neutrals: [
      colorHex(background),
      colorHex(surface),
      colorHex(raised),
      colorHex(input),
      colorHex(border),
      colorHex(mixColor(border, muted, 0.2)),
      colorHex(mixColor(border, muted, 0.4)),
      colorHex(mixColor(border, muted, 0.68)),
      colorHex(mixColor(border, muted, 0.86)),
      colorHex(muted),
      colorHex(mixColor(muted, text, 0.55)),
      colorHex(text),
    ],
    surfaceSunken: colors.surfaceSunken,
    foregroundFaint: colorHex(quietForeground(background, text, 4.5)),
    accent: colorHex(accent.base),
    accentHover: colorHex(accent.hover),
    accentActive: colorHex(accent.active),
    accentForeground: colorHex(accent.foreground),
    accentSoft: colorAlpha(
      accent.base,
      contrastSafeTintAlpha(accent.base, background, dark ? 0.22 : 0.12, 4.55),
    ),
    accentDim: colorHex(mixColor(accent.base, background, 0.58)),
    success: success.base,
    successSoft: success.soft,
    warning: warning.base,
    warningSoft: warning.soft,
    danger: danger.base,
    dangerSoft: danger.soft,
    info: info.base,
    infoSoft: info.soft,
    live: live.base,
    liveSoft: live.soft,
  }
}

const StoredThemeColorsSchema = t.object({
  background: t.string(),
  surface: t.string(),
  surfaceRaised: t.string(),
  surfaceSunken: t.string(),
  text: t.string(),
  textMuted: t.string(),
  input: t.string(),
  border: t.string(),
  accent: t.string(),
  success: t.string(),
  warning: t.string(),
  danger: t.string(),
  info: t.string(),
  live: t.string(),
})

const StoredThemePaletteSchema = t.object({
  advanced: t.boolean(),
  colors: StoredThemeColorsSchema,
})

const StoredThemeCustomizationSchema = t.object({
  enabled: t.boolean().optional(),
  accent: t.string().nullable().optional(),
  palettes: t.object({
    dark: StoredThemePaletteSchema.optional(),
    light: StoredThemePaletteSchema.optional(),
  }),
})

type StoredThemeCustomization = t.infer<typeof StoredThemeCustomizationSchema>
type StoredThemeColors = t.infer<typeof StoredThemeColorsSchema>

function normalizeThemeCustomization(
  value: StoredThemeCustomization,
): ThemeCustomizationState {
  const dark = value.palettes.dark
    ? normalizeStoredPalette(value.palettes.dark)
    : null
  const light = value.palettes.light
    ? normalizeStoredPalette(value.palettes.light)
    : null
  const palettes =
    dark && light ? { dark, light } : dark ? { dark } : light ? { light } : {}
  return {
    accent: value.accent ? themeColorToHex(value.accent) : null,
    palettes,
  }
}

function normalizeStoredPalette(value: {
  advanced: boolean
  colors: StoredThemeColors
}): ThemePaletteCustomization | null {
  const colors = normalizeStoredColors(value.colors)
  return colors ? { advanced: value.advanced, colors } : null
}

function normalizeStoredColors(value: StoredThemeColors): ThemeColors | null {
  const background = themeColorToHex(value.background)
  const surface = themeColorToHex(value.surface)
  const surfaceRaised = themeColorToHex(value.surfaceRaised)
  const surfaceSunken = themeColorToHex(value.surfaceSunken)
  const text = themeColorToHex(value.text)
  const textMuted = themeColorToHex(value.textMuted)
  const input = themeColorToHex(value.input)
  const border = themeColorToHex(value.border)
  const accent = themeColorToHex(value.accent)
  const success = themeColorToHex(value.success)
  const warning = themeColorToHex(value.warning)
  const danger = themeColorToHex(value.danger)
  const info = themeColorToHex(value.info)
  const live = themeColorToHex(value.live)
  if (
    !background ||
    !surface ||
    !surfaceRaised ||
    !surfaceSunken ||
    !text ||
    !textMuted ||
    !input ||
    !border ||
    !accent ||
    !success ||
    !warning ||
    !danger ||
    !info ||
    !live
  ) {
    return null
  }
  return {
    background,
    surface,
    surfaceRaised,
    surfaceSunken,
    text,
    textMuted,
    input,
    border,
    accent,
    success,
    warning,
    danger,
    info,
    live,
  }
}

function accentTokenDeclarations(
  value: string,
  backgroundValue: string,
  mode: ThemePresetMode,
): string {
  const background = requireColor(
    backgroundValue,
    mode === "dark" ? DARK_FALLBACK.background : LIGHT_FALLBACK.background,
  )
  const accent = createAccentColors(value, background)
  const dark = relativeLuminance(background) < 0.179
  const alpha = (opacity: number) => colorAlpha(accent.base, opacity)
  const softAlpha = contrastSafeTintAlpha(
    accent.base,
    background,
    dark ? 0.22 : 0.12,
    4.55,
  )
  const lines = [
    `--primary: ${colorHex(accent.base)};`,
    `--primary-foreground: ${colorHex(accent.foreground)};`,
    `--accent: ${colorHex(accent.base)};`,
    `--accent-hover: ${colorHex(accent.hover)};`,
    `--accent-active: ${colorHex(accent.active)};`,
    `--accent-foreground: ${colorHex(accent.foreground)};`,
    `--accent-soft: ${alpha(softAlpha)};`,
    `--accent-border: ${alpha(dark ? 0.55 : 0.4)};`,
    `--accent-glow: ${alpha(dark ? 0.38 : 0.28)};`,
    `--accent-dim: ${colorHex(mixColor(accent.base, background, 0.58))};`,
  ]
  return lines.map((line) => `  ${line}`).join("\n")
}

const DARK_FALLBACK = {
  background: "#1c1c1c",
  surface: "#262626",
  surfaceRaised: "#303030",
  surfaceSunken: "#121212",
  text: "#fafafa",
  textMuted: "#c6c6c6",
  input: "#3b3b3b",
  border: "#454545",
  accent: "#d0c4eb",
  success: "#4fc66b",
  warning: "#e8bd45",
  danger: "#e34f4f",
  info: "#50a9dc",
  live: "#e34f4f",
} satisfies ThemeColors

const LIGHT_FALLBACK = {
  background: "#fcfcfc",
  surface: "#f7f7f7",
  surfaceRaised: "#f0f0f0",
  surfaceSunken: "#eeeeee",
  text: "#303030",
  textMuted: "#666666",
  input: "#e6e6e6",
  border: "#dddddd",
  accent: "#5d4f96",
  success: "#2b8a45",
  warning: "#a56b12",
  danger: "#c93636",
  info: "#287aa8",
  live: "#c93636",
} satisfies ThemeColors

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
const SOFT_BLACK: Rgba = { r: 16, g: 14, b: 18, a: 1 }
const SOFT_WHITE: Rgba = { r: 250, g: 248, b: 252, a: 1 }

function requireColor(value: string, fallback: string): Rgba {
  return parseCssColor(value) ?? parseCssColor(fallback) ?? BLACK
}

function colorHex(color: Rgba): string {
  return formatCssColor({ ...color, a: 1 })
}

function colorAlpha(color: Rgba, alpha: number): string {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Number(alpha.toFixed(4))})`
}

function readableForeground(background: Rgba): Rgba {
  const candidates = [SOFT_WHITE, SOFT_BLACK, WHITE, BLACK]
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, background) > contrastRatio(best, background)
      ? candidate
      : best,
  )
}

function createAccentColors(value: string, background: Rgba) {
  const color = requireColor(value, DARK_FALLBACK.accent)
  const dark = relativeLuminance(background) < 0.179
  const base = ensureTintedContrast(color, background, dark ? 0.22 : 0.12, 4.5)
  const foreground = readableForeground(base)
  return {
    base,
    foreground,
    hover: ensureContrast(
      mixColor(base, dark ? WHITE : BLACK, dark ? 0.12 : 0.14),
      foreground,
      4.5,
    ),
    active: ensureContrast(
      mixColor(base, dark ? BLACK : WHITE, dark ? 0.14 : 0.12),
      foreground,
      4.5,
    ),
  }
}

function contrastSafeTintAlpha(
  foreground: Rgba,
  background: Rgba,
  preferredAlpha: number,
  minimumContrast: number,
): number {
  if (
    contrastRatio(
      foreground,
      compositeColor(background, foreground, preferredAlpha),
    ) >= minimumContrast
  ) {
    return preferredAlpha
  }

  let low = 0
  let high = preferredAlpha
  for (let step = 0; step < 16; step += 1) {
    const alpha = (low + high) / 2
    if (
      contrastRatio(
        foreground,
        compositeColor(background, foreground, alpha),
      ) >= minimumContrast
    ) {
      low = alpha
    } else {
      high = alpha
    }
  }
  return low
}

function ensureTintedContrast(
  color: Rgba,
  background: Rgba,
  tintAlpha: number,
  minimumContrast: number,
): Rgba {
  const target =
    contrastRatio(WHITE, background) > contrastRatio(BLACK, background)
      ? WHITE
      : BLACK
  return adjustColor(color, target, (candidate) => {
    const tint = compositeColor(background, candidate, tintAlpha)
    return (
      contrastRatio(candidate, background) >= minimumContrast &&
      contrastRatio(candidate, tint) >= minimumContrast
    )
  })
}

function ensureContrast(
  color: Rgba,
  background: Rgba,
  minimumContrast: number,
): Rgba {
  const target =
    contrastRatio(WHITE, background) > contrastRatio(BLACK, background)
      ? WHITE
      : BLACK
  return adjustColor(
    color,
    target,
    (candidate) => contrastRatio(candidate, background) >= minimumContrast,
  )
}

function adjustColor(
  color: Rgba,
  target: Rgba,
  accepts: (candidate: Rgba) => boolean,
): Rgba {
  if (accepts(color)) return color

  let low = 0
  let high = 1
  for (let step = 0; step < 16; step += 1) {
    const amount = (low + high) / 2
    if (accepts(mixColor(color, target, amount))) high = amount
    else low = amount
  }
  return mixColor(color, target, high)
}

function quietForeground(
  background: Rgba,
  foreground: Rgba,
  minimumContrast: number,
): Rgba {
  if (contrastRatio(foreground, background) < minimumContrast) return foreground

  let readable = foreground
  let low = 0
  let high = 1
  for (let step = 0; step < 14; step += 1) {
    const amount = (low + high) / 2
    const candidate = mixColor(foreground, background, amount)
    if (contrastRatio(candidate, background) >= minimumContrast) {
      readable = candidate
      low = amount
    } else {
      high = amount
    }
  }
  return readable
}

function compositeColor(
  background: Rgba,
  foreground: Rgba,
  alpha: number,
): Rgba {
  return {
    r: background.r + (foreground.r - background.r) * alpha,
    g: background.g + (foreground.g - background.g) * alpha,
    b: background.b + (foreground.b - background.b) * alpha,
    a: 1,
  }
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: Rgba): number {
  const linearize = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * linearize(color.r) +
    0.7152 * linearize(color.g) +
    0.0722 * linearize(color.b)
  )
}

/** Perceptual interpolation keeps tinted ramps from passing through gray. */
function mixColor(first: Rgba, second: Rgba, amount: number): Rgba {
  const start = rgbToOklab(first)
  const end = rgbToOklab(second)
  return oklabToRgb({
    l: start.l + (end.l - start.l) * amount,
    a: start.a + (end.a - start.a) * amount,
    b: start.b + (end.b - start.b) * amount,
  })
}

interface Oklab {
  l: number
  a: number
  b: number
}

function rgbToOklab(color: Rgba): Oklab {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const red = linear(color.r)
  const green = linear(color.g)
  const blue = linear(color.b)
  const l = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  )
  const m = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  )
  const s = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  )
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function oklabToRgb(color: Oklab): Rgba {
  const l = (color.l + 0.3963377774 * color.a + 0.2158037573 * color.b) ** 3
  const m = (color.l - 0.1055613458 * color.a - 0.0638541728 * color.b) ** 3
  const s = (color.l - 0.0894841775 * color.a - 1.291485548 * color.b) ** 3
  const encode = (channel: number) => {
    const value =
      channel <= 0.0031308
        ? channel * 12.92
        : 1.055 * channel ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, value)) * 255)
  }
  return {
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  }
}
