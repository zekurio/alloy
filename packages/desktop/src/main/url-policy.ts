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

export function normalizeServerOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.username || url.password || !isSecureServerUrl(url)) return null
    return url.origin
  } catch {
    return null
  }
}

export function sameOrigin(rawUrl: string, origin: string): boolean {
  try {
    return new URL(rawUrl).origin === origin
  } catch {
    return false
  }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export function selectedServerPathUrl(
  serverOrigin: string,
  path: string,
): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null
  try {
    const target = new URL(path, serverOrigin)
    return target.origin === serverOrigin ? target.toString() : null
  } catch {
    return null
  }
}

export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status <= 399 && status !== 304
}
