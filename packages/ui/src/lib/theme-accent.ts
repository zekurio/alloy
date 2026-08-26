import { t } from "@alloy/contracts/schema"
import { formatCssColor, parseCssColor, type Rgba } from "@alloy/ui/lib/color"
import {
  getStoredThemePalette,
  type ThemePresetMode,
} from "@alloy/ui/lib/theme-presets"
import { THEME_ACCENT_STYLE_ID } from "@alloy/ui/lib/theme-style"

/** Retains the existing key so saved accent choices survive this simplification. */
export const THEME_ACCENT_STORAGE_KEY = "alloy.themeColors"

export interface ThemeAccentState {
  accents: Partial<Record<ThemePresetMode, string>>
}

export const DEFAULT_THEME_ACCENTS: ThemeAccentState = { accents: {} }

let sessionThemeAccents: ThemeAccentState | null = null

export function readThemeAccents(): ThemeAccentState {
  if (sessionThemeAccents) return sessionThemeAccents
  if (!globalThis.window) return DEFAULT_THEME_ACCENTS

  try {
    const stored = window.localStorage.getItem(THEME_ACCENT_STORAGE_KEY)
    if (!stored) return DEFAULT_THEME_ACCENTS
    const parsed = StoredThemeAccentsSchema.safeParse(JSON.parse(stored))
    return parsed.success
      ? normalizeThemeAccents(parsed.data)
      : DEFAULT_THEME_ACCENTS
  } catch {
    return DEFAULT_THEME_ACCENTS
  }
}

export function writeThemeAccents(state: ThemeAccentState): void {
  if (!globalThis.window) return
  try {
    window.localStorage.setItem(THEME_ACCENT_STORAGE_KEY, JSON.stringify(state))
    sessionThemeAccents = null
  } catch {
    sessionThemeAccents = state
  }
  applyThemeAccents(state)
}

export function applyStoredThemeAccents(): void {
  applyThemeAccents(readThemeAccents())
}

export function applyThemeAccents(state: ThemeAccentState): void {
  if (!globalThis.document) return

  const existing = document.getElementById(THEME_ACCENT_STYLE_ID)
  const storedPalette = getStoredThemePalette()
  const sections = (["dark", "light"] as const).flatMap((mode) => {
    const accent = state.accents[mode]
    if (!accent) return []
    const selector = mode === "dark" ? ":root.dark,\n.dark" : ":root.light"
    return `${selector} {\n${accentTokenDeclarations(
      accent,
      storedPalette[mode].tokens.neutrals[0],
      mode,
    )}\n}`
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
  style.id = THEME_ACCENT_STYLE_ID
  if (style.textContent !== css) style.textContent = css
  document.head.append(style)
}

/** Converts a picker-compatible CSS color into the opaque hex stored by themes. */
export function themeAccentToHex(value: string): string | null {
  const color = parseCssColor(value)
  if (!color) return null
  return formatCssColor({ ...color, a: 1 })
}

const StoredThemeAccentsSchema = t.object({
  /** Legacy builds stored one accent for both appearances. */
  accent: t.string().nullable().optional(),
  accents: t
    .object({
      dark: t.string().optional(),
      light: t.string().optional(),
    })
    .optional(),
})

type StoredThemeAccents = t.infer<typeof StoredThemeAccentsSchema>

function normalizeThemeAccents(value: StoredThemeAccents): ThemeAccentState {
  const legacyAccent = value.accent ? themeAccentToHex(value.accent) : null
  const dark = value.accents?.dark
    ? themeAccentToHex(value.accents.dark)
    : legacyAccent
  const light = value.accents?.light
    ? themeAccentToHex(value.accents.light)
    : legacyAccent
  const accents =
    dark && light ? { dark, light } : dark ? { dark } : light ? { light } : {}
  return { accents }
}

function accentTokenDeclarations(
  value: string,
  backgroundValue: string,
  mode: ThemePresetMode,
): string {
  const background = requireColor(
    backgroundValue,
    mode === "dark" ? "#1c1c1c" : "#fcfcfc",
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

function createAccentColors(value: string, background: Rgba) {
  const color = requireColor(value, "#d0c4eb")
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

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
const SOFT_BLACK: Rgba = { r: 16, g: 14, b: 18, a: 1 }
const SOFT_WHITE: Rgba = { r: 250, g: 248, b: 252, a: 1 }
