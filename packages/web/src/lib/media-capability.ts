const probeResults = new Map<string, boolean>()

/** Browser support for a fully probed container/codec combination. */
export function canPlaySource(contentType: string, codecs: string): boolean {
  if (!codecs) return false
  return probe(`${contentType}; codecs="${codecs}"`)
}

/**
 * Browser support for a container whose codecs are unknown, as for local
 * library files. The browser only answers "maybe" here; whether the file
 * decodes shows when it loads.
 */
export function canPlayContainer(contentType: string): boolean {
  return probe(contentType)
}

function probe(type: string): boolean {
  if (!globalThis.document) return true
  const cached = probeResults.get(type)
  if (cached !== undefined) return cached
  const result = document.createElement("video").canPlayType(type) !== ""
  probeResults.set(type, result)
  return result
}
