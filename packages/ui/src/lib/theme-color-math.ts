import { formatCssColor, parseCssColor, type Rgba } from "@alloy/ui/lib/color"

/**
 * Contrast and mixing helpers for generated theme colors. Contrast follows
 * WCAG relative luminance; mixing happens in OKLab so tinted ramps never pass
 * through gray.
 */

export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
const SOFT_BLACK: Rgba = { r: 16, g: 14, b: 18, a: 1 }
const SOFT_WHITE: Rgba = { r: 250, g: 248, b: 252, a: 1 }

/** Parses any CSS color, falling back when the value isn't one. */
export function colorOr(value: string, fallback: string): Rgba {
  return parseCssColor(value) ?? parseCssColor(fallback) ?? BLACK
}

/** Opaque `#rrggbb`, the canonical form stored for theme colors. */
export function colorHex(color: Rgba): string {
  return formatCssColor({ ...color, a: 1 })
}

/** Reads like a dark background: white text contrasts better than black. */
export function isDarkColor(color: Rgba): boolean {
  return relativeLuminance(color) < 0.179
}

export function readableForeground(background: Rgba): Rgba {
  const candidates = [SOFT_WHITE, SOFT_BLACK, WHITE, BLACK]
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, background) > contrastRatio(best, background)
      ? candidate
      : best,
  )
}

export function contrastRatio(first: Rgba, second: Rgba): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

/** Lightens or darkens `color` just enough to reach the contrast target. */
export function ensureContrast(
  color: Rgba,
  background: Rgba,
  minimumContrast: number,
): Rgba {
  return adjustColor(
    color,
    contrastTarget(background),
    (candidate) => contrastRatio(candidate, background) >= minimumContrast,
  )
}

/**
 * Like {@link ensureContrast}, but the color must also stay readable on its
 * own translucent tint, which is how active rows and chips render it.
 */
export function ensureTintedContrast(
  color: Rgba,
  background: Rgba,
  tintAlpha: number,
  minimumContrast: number,
): Rgba {
  return adjustColor(color, contrastTarget(background), (candidate) => {
    const tint = compositeColor(background, candidate, tintAlpha)
    return (
      contrastRatio(candidate, background) >= minimumContrast &&
      contrastRatio(candidate, tint) >= minimumContrast
    )
  })
}

/** The largest tint opacity, up to `preferredAlpha`, that keeps text legible. */
export function contrastSafeTintAlpha(
  foreground: Rgba,
  background: Rgba,
  preferredAlpha: number,
  minimumContrast: number,
): number {
  const passes = (alpha: number) =>
    contrastRatio(foreground, compositeColor(background, foreground, alpha)) >=
    minimumContrast
  if (passes(preferredAlpha)) return preferredAlpha

  let low = 0
  let high = preferredAlpha
  for (let step = 0; step < 16; step += 1) {
    const alpha = (low + high) / 2
    if (passes(alpha)) low = alpha
    else high = alpha
  }
  return low
}

/** Paints `foreground` at `alpha` over an opaque `background`. */
export function compositeColor(
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

/** Perceptual interpolation keeps tinted ramps from passing through gray. */
export function mixColor(first: Rgba, second: Rgba, amount: number): Rgba {
  const start = rgbToOklab(first)
  const end = rgbToOklab(second)
  return oklabToRgb({
    l: start.l + (end.l - start.l) * amount,
    a: start.a + (end.a - start.a) * amount,
    b: start.b + (end.b - start.b) * amount,
  })
}

function contrastTarget(background: Rgba): Rgba {
  return contrastRatio(WHITE, background) > contrastRatio(BLACK, background)
    ? WHITE
    : BLACK
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

/** sRGB byte to linear light. */
function linearize(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * linearize(color.r) +
    0.7152 * linearize(color.g) +
    0.0722 * linearize(color.b)
  )
}

interface Oklab {
  l: number
  a: number
  b: number
}

function rgbToOklab(color: Rgba): Oklab {
  const red = linearize(color.r)
  const green = linearize(color.g)
  const blue = linearize(color.b)
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
