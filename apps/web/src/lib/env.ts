const DEFAULT_SERVER_URL = "http://localhost:3000"
const DEFAULT_WEB_URL = "http://localhost:5173"

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/api\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function webServerUrl(): string {
  return (
    import.meta.env.VITE_SERVER_URL ??
    process.env.VITE_SERVER_URL ??
    DEFAULT_SERVER_URL
  )
}

export function apiOrigin(): string {
  return normalizeOrigin(webServerUrl())
}

export function publicOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin
  return normalizeOrigin(process.env.PUBLIC_APP_URL ?? DEFAULT_WEB_URL)
}
