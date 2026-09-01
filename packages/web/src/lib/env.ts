import { nonEmpty, normalizePublicServerUrl } from "@alloy/env"

const DEFAULT_SERVER_URL = "http://localhost:2552"
function webServerUrl(): string {
  if (globalThis.window) return window.location.origin

  return (
    nonEmpty(process.env.INTERNAL_API_URL) ??
    nonEmpty(process.env.VITE_SERVER_URL) ??
    DEFAULT_SERVER_URL
  )
}

export function apiOrigin(): string {
  return normalizePublicServerUrl(webServerUrl())
}

export function publicOrigin(): string {
  if (globalThis.window) return window.location.origin
  return normalizePublicServerUrl(
    nonEmpty(process.env.PUBLIC_SERVER_URL) ?? webServerUrl(),
  )
}
