const SNOWCODE_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]":,.-_'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Encodes a clip UUID as the numeric Mastodon-style status ID Discord expects.
 * This is FxEmbed's snowcode format, narrowed to Alloy's `{ i: id, v: 4 }`
 * payload so decoding untrusted route parameters does not require JSON.parse.
 * The layout version gives each Discord status response a fresh cache key.
 */
export function encodeDiscordActivityId(clipId: string): string {
  return `"i":"${clipId}","v":4`
    .split("")
    .map((character) => {
      const index = SNOWCODE_CHARACTERS.indexOf(character)
      if (index === -1) {
        throw new Error(`clip ID contains unsupported character: ${character}`)
      }
      return String(index).padStart(2, "0")
    })
    .join("")
}

export function decodeDiscordActivityId(snowcode: string): string | null {
  if (!/^\d+$/.test(snowcode) || snowcode.length % 2 !== 0) return null

  const pairs = snowcode.match(/\d{2}/g)
  if (!pairs) return null

  const decoded = pairs
    .map((pair) => SNOWCODE_CHARACTERS[Number(pair)] ?? "")
    .join("")
  // Keep decoding the original unversioned IDs so already-shared links remain
  // resolvable after the cache-busting layout change.
  const match = /^"i":"([^"]+)"(?:,"v":[2-4])?$/.exec(decoded)
  if (!match?.[1] || !UUID_RE.test(match[1])) return null
  return match[1].toLowerCase()
}
