const DEFAULT_SERVER_URL = "http://localhost:3000"

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

function webServerUrl(): string {
  if (typeof window !== "undefined") {
    return nonEmpty(import.meta.env.VITE_SERVER_URL) ?? window.location.origin
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
  return normalizeOrigin(nonEmpty(process.env.PUBLIC_SERVER_URL) ?? webServerUrl())
}
