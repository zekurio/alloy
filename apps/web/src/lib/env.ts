const DEFAULT_SERVER_URL = "http://localhost:2552"
const DEFAULT_SERVER_PORT = "2552"

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/api\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isDefaultLocalServerUrl(value: string): boolean {
  const url = new URL(value)
  return (
    url.protocol === "http:" &&
    url.hostname === "localhost" &&
    url.port === DEFAULT_SERVER_PORT
  )
}

function browserServerUrl(value: string | undefined): string {
  const configured = nonEmpty(value)
  if (!configured) return window.location.origin
  if (!isDefaultLocalServerUrl(configured)) return configured
  return window.location.origin
}

function webServerUrl(): string {
  if (typeof window !== "undefined") {
    return browserServerUrl(import.meta.env.VITE_SERVER_URL)
  }

  return (
    nonEmpty(process.env.INTERNAL_API_URL) ??
    nonEmpty(process.env.VITE_SERVER_URL) ??
    DEFAULT_SERVER_URL
  )
}

export function apiOrigin(): string {
  return normalizeOrigin(webServerUrl())
}

export function publicOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin
  return normalizeOrigin(
    nonEmpty(process.env.PUBLIC_SERVER_URL) ?? webServerUrl()
  )
}
