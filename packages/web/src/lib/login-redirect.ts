/**
 * Sanitize a `?redirect=` target for the login page. Only same-origin absolute
 * paths are allowed: protocol-relative (`//host`) and backslash variants are
 * rejected so the value can never send the user (or a freshly issued desktop
 * login code) to another origin. Used by the desktop browser-login handshake,
 * which returns to `/api/auth/desktop/authorize` after sign-in.
 */
export function sanitizeLoginRedirect(cause: unknown): string | null {
  const result = LoginRedirectSchema.safeParse(cause)
  if (!result.success || result.data.length === 0) return null
  const redirect = result.data
  if (!redirect.startsWith("/")) return null
  if (redirect.startsWith("//") || redirect.startsWith("/\\")) return null
  return redirect
}
import { t } from "@alloy/contracts/schema"

const LoginRedirectSchema = t.string()
