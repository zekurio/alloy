// Client calls hit the same origin; the Nitro `/api/$` route proxies to
// the hono server (INTERNAL_API_URL in prod, http://localhost:3000 in dev).
export function apiOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin
  return process.env.INTERNAL_API_URL ?? "http://localhost:3000"
}
