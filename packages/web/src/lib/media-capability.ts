const probeResults = new Map<string, boolean>()

/**
 * Whether the browser can play a container/codec combination. Empty codecs on
 * a video/mp4 container is treated as playable — legacy renditions predate
 * codec metadata and were encoded as H.264, so that assumption holds there.
 * A source with unprobed (null → "") codecs still resolves through
 * `canPlayType(contentType)` alone, which returns "maybe" (non-empty) rather
 * than asserting playability outright. Results are cached — callers probe the
 * same handful of codec strings across every clip card in a list render.
 */
export function canPlaySource(contentType: string, codecs: string): boolean {
  if (typeof document === "undefined") return true
  const key = `${contentType}|${codecs}`
  const cached = probeResults.get(key)
  if (cached !== undefined) return cached
  const result =
    document
      .createElement("video")
      .canPlayType(
        codecs ? `${contentType}; codecs="${codecs}"` : contentType,
      ) !== ""
  probeResults.set(key, result)
  return result
}
