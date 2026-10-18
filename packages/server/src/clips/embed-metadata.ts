import { oklchToHex, stableHue } from "@alloy/contracts"

const ACCENT_LIGHTNESS = 0.7
const ACCENT_CHROMA = 0.15

/** Each game keeps a stable embed accent; clips without a game share a hue. */
export function clipAccentColor(gameName: string | null): string {
  const name = gameName?.trim()
  return oklchToHex(
    ACCENT_LIGHTNESS,
    ACCENT_CHROMA,
    name ? stableHue(name) : 220,
  )
}

/** The small provider line above the clip title links to the uploader. */
export function clipEmbedProvider(username: string, origin: string) {
  return {
    name: `${username} on alloy`,
    url: new URL(`/u/${encodeURIComponent(username)}`, origin).toString(),
  }
}
