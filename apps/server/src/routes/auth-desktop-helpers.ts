const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

export function loopbackRedirect(value: string | null | undefined): URL | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:") return null
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null
  return url
}
