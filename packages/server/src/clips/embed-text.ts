import { oklchToHex, stableHue } from "@alloy/contracts"

// Vivid enough to read as an accent against Discord's dark surface, but not so
// saturated that a wall of clips becomes noisy.
const ACCENT_LIGHTNESS = 0.7
const ACCENT_CHROMA = 0.15

/**
 * Accent colour for a clip's embed, derived from its game so the same game
 * always reads the same colour. Uncategorised clips share one neutral hue.
 */
export function clipAccentColor(gameName: string | null): string {
  return oklchToHex(
    ACCENT_LIGHTNESS,
    ACCENT_CHROMA,
    gameName ? stableHue(gameName) : 220,
  )
}

/**
 * Fluxer renders Markdown in OpenGraph descriptions. Other crawlers get plain
 * text, and clips without a known game page never get a guessed link.
 */
export function clipEmbedDescription(
  clip: { gameName: string; gameSlug: string | null },
  origin: string,
  userAgent = "",
): string {
  if (!clip.gameSlug || !/\bFluxerbot(?:\/|$)/i.test(userAgent)) {
    return clip.gameName
  }

  const label = clip.gameName.replace(/[\\`*_[\]<>~]/g, "\\$&")
  const slug = encodeURIComponent(clip.gameSlug)
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
  const url = new URL(`/games/${slug}`, origin).toString()
  return `[${label}](${url})`
}
