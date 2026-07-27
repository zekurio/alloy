export function stableHash(seed: string | number): number {
  const value = String(seed)
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

export function stableHue(seed: string | number): number {
  return stableHash(seed) % 360
}

/**
 * Convert an OKLCH colour to an sRGB hex string.
 *
 * The app styles in OKLCH so hues at equal lightness/chroma read as equally
 * bright — with HSL, yellows and greens visibly outshine blues, which is
 * obvious once a set of per-game accents sits side by side. External consumers
 * (a `theme-color` meta tag, say) only understand hex, so the conversion has to
 * happen somewhere; doing it here keeps one colour model in the codebase.
 */
export function oklchToHex(
  lightness: number,
  chroma: number,
  hueDegrees: number,
): string {
  const hue = (hueDegrees * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)

  // OKLab -> approximate cone responses -> linear sRGB (Björn Ottosson).
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
    .map((channel) => {
      // Out-of-gamut values are clipped, which is fine for accent colours.
      const srgb =
        channel <= 0.0031308
          ? 12.92 * channel
          : 1.055 * channel ** (1 / 2.4) - 0.055
      const byte = Math.round(Math.min(1, Math.max(0, srgb)) * 255)
      return byte.toString(16).padStart(2, "0")
    })
    .join("")
    .replace(/^/, "#")
}
