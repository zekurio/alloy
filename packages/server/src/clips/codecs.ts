export function renditionIsH264(codecs: string | null | undefined): boolean {
  if (!codecs) return true
  return codecs
    .split(",")
    .map((codec) => codec.trim().toLowerCase())
    .some((codec) => codec.startsWith("avc1."))
}

/**
 * Whether embed scrapers' plain `<video>` players can be expected to decode
 * the source: H.264 video and, when an audio entry is present, AAC. A source
 * with e.g. AC-3 audio would play silently, so embeds prefer the AAC og
 * rendition instead.
 */
export function sourceIsBroadlyDecodable(codecs: string | null): boolean {
  if (!codecs) return false
  const parts = codecs.split(",").map((codec) => codec.trim().toLowerCase())
  if (!parts[0]?.startsWith("avc1.")) return false
  return parts.slice(1).every((codec) => codec.startsWith("mp4a.40."))
}
