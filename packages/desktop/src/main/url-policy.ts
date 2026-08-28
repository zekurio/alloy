const IPV4_PART = /^\d{1,3}$/

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true
  }

  const parts = normalized.split(".")
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every(
      (part) =>
        IPV4_PART.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  )
}

export function isSecureServerUrl(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackHost(url.hostname))
  )
}

export function sameOrigin(rawUrl: string, origin: string): boolean {
  try {
    return new URL(rawUrl).origin === origin
  } catch {
    return false
  }
}

export function isSelectedServerExternalUrl(
  rawUrl: string,
  selectedServerUrl: string | null,
): boolean {
  return selectedServerUrl !== null && sameOrigin(rawUrl, selectedServerUrl)
}
