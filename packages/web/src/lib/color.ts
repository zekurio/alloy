import type { CSSProperties } from "react"

// Small, dependency-free color helpers shared by the color picker and the
// profile accent theming. Hues are 0–360; s/v/l are 0–1; channels are 0–255.

export type Rgb = { r: number; g: number; b: number }
export type Hsv = { h: number; s: number; v: number }
export type Hsl = { h: number; s: number; l: number }

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Normalize loose input ("#abc", "ABCDEF") to a canonical "#rrggbb", or null. */
export function normalizeHex(input: string): string | null {
  const match = HEX_RE.exec(input.trim())
  if (!match) return null
  let hex = match[1] as string
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("")
  }
  return `#${hex.toLowerCase()}`
}

export function hexToRgb(hex: string): Rgb | null {
  const norm = normalizeHex(hex)
  if (!norm) return null
  const int = Number.parseInt(norm.slice(1), 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, "0")
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/**
 * Map a hue (0–360) plus chroma/intermediate/match terms to RGB channels.
 * Shared tail of the HSV→RGB and HSL→RGB conversions, which only differ in
 * how they derive `c` and `m`.
 */
function hueToRgb(h: number, c: number, m: number): Rgb {
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s
  return hueToRgb(h, c, v - c)
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToHsv(rgb) : null
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv))
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  return hueToRgb(h, c, l - c / 2)
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Dark or light foreground that reads on top of the given color. */
export function readableForeground(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return "#0b0a0f"
  return relativeLuminance(rgb) > 0.45 ? "#0b0a0f" : "#ffffff"
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha})`
}

function shiftLightness(hex: string, delta: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const hsl = rgbToHsl(rgb)
  return rgbToHex(hslToRgb({ ...hsl, l: clamp(hsl.l + delta, 0, 1) }))
}

/**
 * CSS custom-property overrides that re-theme the `--accent` family (and the
 * `--primary`/`--ring` aliases) to a single base color. Apply via `style` on a
 * container to retint everything inside it.
 */
export function accentCssVars(hex: string): CSSProperties {
  const base = normalizeHex(hex) ?? hex
  return {
    "--accent": base,
    "--accent-hover": shiftLightness(base, 0.08),
    "--accent-active": shiftLightness(base, -0.1),
    "--accent-foreground": readableForeground(base),
    "--accent-soft": withAlpha(base, 0.22),
    "--accent-border": withAlpha(base, 0.5),
    "--accent-glow": withAlpha(base, 0.38),
    "--accent-dim": shiftLightness(base, -0.3),
    "--primary": base,
    "--primary-foreground": readableForeground(base),
    "--ring": base,
  } as CSSProperties
}
