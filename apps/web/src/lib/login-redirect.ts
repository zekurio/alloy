/**
 * Sanitize a `?redirect=` target for the login page. Only same-origin absolute
 * paths are allowed: protocol-relative (`//host`) and backslash variants are
 * rejected so the value can never send the user (or a freshly issued desktop
 * login code) to another origin. Used by the desktop browser-login handshake,
 * which returns to `/api/auth/desktop/authorize` after sign-in.
 */
export function sanitizeLoginRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null
  if (!value.startsWith("/")) return null
  if (value.startsWith("//") || value.startsWith("/\\")) return null
  return value
}
