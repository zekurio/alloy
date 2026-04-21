export function apiOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin
  return process.env.INTERNAL_API_URL ?? "http://localhost:3000"
}

export function publicOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin
  return process.env.PUBLIC_APP_URL ?? "http://localhost:3000"
}
