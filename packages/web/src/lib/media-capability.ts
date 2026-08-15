const probeResults = new Map<string, boolean>()

/** Browser support for a fully probed container/codec combination. */
export function canPlaySource(contentType: string, codecs: string): boolean {
  if (!codecs) return false
  if (!globalThis.document) return true
  const key = `${contentType}|${codecs}`
  const cached = probeResults.get(key)
  if (cached !== undefined) return cached
  const result =
    document
      .createElement("video")
      .canPlayType(`${contentType}; codecs="${codecs}"`) !== ""
  probeResults.set(key, result)
  return result
}
