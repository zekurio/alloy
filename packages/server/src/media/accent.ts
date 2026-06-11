import { logger } from "alloy-logging"

import { runImageMagick } from "./imagemagick"

type Hsl = { h: number; s: number; l: number }

function hexToHsl(hex: string): Hsl | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const int = Number.parseInt(match[1] as string, 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, l }
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const channel = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/**
 * Pull a vibrant accent toward a light, readable range so it works as the
 * lavender replacement on the dark, frosted profile surface.
 */
function normalizeAccent({ h, s, l }: Hsl): Hsl {
  return {
    h,
    s: Math.min(0.72, Math.max(0.45, s)),
    l: Math.min(0.82, Math.max(0.7, l)),
  }
}

/**
 * Derive a single accent hex from an image by quantizing it to a small palette
 * and picking the most prominent vibrant, mid-luminance color, then nudging it
 * into the accent range. Returns null if extraction fails or the image is
 * effectively greyscale.
 */
export async function deriveAccentColor(
  bytes: Uint8Array,
): Promise<string | null> {
  let out: Buffer
  try {
    out = await runImageMagick(
      [
        "-",
        "-resize",
        "120x120",
        "-colors",
        "16",
        "-depth",
        "8",
        "-format",
        "%c",
        "histogram:info:-",
      ],
      bytes,
    )
  } catch (cause) {
    logger.warn("[accent] failed to derive accent color:", cause)
    return null
  }

  const histogram = out.toString("utf8")
  const entry = /(\d+):\s*\([^)]*\)\s*#([0-9a-f]{6})/gi
  let match: RegExpExecArray | null
  let best: Hsl | null = null
  let bestScore = -1
  while ((match = entry.exec(histogram)) !== null) {
    const count = Number(match[1])
    const hsl = hexToHsl(match[2] as string)
    if (!hsl) continue
    // Skip near-greys and near-black/near-white — they make muddy accents.
    if (hsl.s < 0.12 || hsl.l < 0.08 || hsl.l > 0.95) continue
    const score = count * (0.35 + hsl.s) * (1 - Math.abs(hsl.l - 0.5))
    if (score > bestScore) {
      bestScore = score
      best = hsl
    }
  }

  if (!best) return null
  return hslToHex(normalizeAccent(best))
}
