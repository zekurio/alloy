import { oklchToHex, stableHue } from "@alloy/contracts"

// Vivid enough to read as an accent against Discord's dark surface, but not so
// saturated that a wall of clips becomes noisy.
const ACCENT_LIGHTNESS = 0.7
const ACCENT_CHROMA = 0.15
const STAT_UNITS = ["K", "M", "B", "T"] as const

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
 * Compact, locale-free counts for the embed wire format. The web app's
 * formatCount is locale-aware via the i18n runtime, which has no meaning in
 * someone else's Discord client.
 */
export function formatStatCount(value: number): string {
  const count = Math.trunc(Math.abs(value))
  if (count < 1_000) return String(count)

  let divisor = 1_000
  let unitIndex = 0
  while (unitIndex < STAT_UNITS.length - 1 && count >= divisor * 1_000) {
    divisor *= 1_000
    unitIndex += 1
  }

  const scaled = Math.trunc((count / divisor) * 10) / 10
  const formatted = Number.isInteger(scaled)
    ? String(scaled)
    : scaled.toFixed(1)
  return `${formatted}${STAT_UNITS[unitIndex]}`
}

/**
 * The embed's description line: game, then engagement. Counts are always shown,
 * including zeros — a clip with no likes yet should still read as a clip with
 * likes rather than losing the row and shifting the layout.
 */
export function clipEmbedDescription(clip: {
  gameName: string
  viewCount: number
  likeCount: number
  commentCount: number
}): string {
  return [
    clip.gameName,
    `👁 ${formatStatCount(clip.viewCount)}`,
    `❤️ ${formatStatCount(clip.likeCount)}`,
    `💬 ${formatStatCount(clip.commentCount)}`,
  ].join(" · ")
}
