const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"])

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

export function isSecureServerUrl(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackHost(url.hostname))
  )
}

export function canOpenExternally(rawUrl: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

export function sameOrigin(rawUrl: string, origin: string): boolean {
  try {
    return new URL(rawUrl).origin === origin
  } catch {
    return false
  }
}
