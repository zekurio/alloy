import { AUTH_ERROR_CODES, type AuthErrorCode } from "@alloy/contracts"
import type { AuthenticatedSignInResult } from "@alloy/server/auth/account-sign-in"
import { publicSessionData } from "@alloy/server/auth/security-responses"
import { configStore } from "@alloy/server/config/store"
import { env } from "@alloy/server/env"
import { forbidden } from "@alloy/server/runtime/http-response"
import type { Context } from "hono"
import { createMiddleware } from "hono/factory"

const MUTATING_METHODS = new Set(["POST", "PATCH", "DELETE", "PUT"])
const CSRF_EXEMPT_PATHS = ["/api/assets/upload/"]

function isCsrfExemptPath(path: string): boolean {
  return CSRF_EXEMPT_PATHS.some((prefix) => path.startsWith(prefix))
}

function trustedOrigins(): Set<string> {
  return new Set(env.TRUSTED_ORIGINS)
}

export const csrf = createMiddleware(async (c, next) => {
  if (!MUTATING_METHODS.has(c.req.method) || isCsrfExemptPath(c.req.path)) {
    await next()
    return
  }

  // Sec-Fetch-Site is a forbidden header name (page JS can never set it), so
  // "same-origin" is browser-attested proof the request came from our own
  // pages. It must be checked before Origin: the Fetch spec serializes Origin
  // as "null" on non-GET requests under a no-referrer referrer policy, and
  // privacy-hardened browsers do the same regardless of policy, so a
  // legitimate same-origin form post can arrive with `Origin: null`.
  const fetchSite = c.req.header("sec-fetch-site")
  if (fetchSite === "same-origin") {
    await next()
    return
  }
  if (fetchSite === "cross-site" || fetchSite === "none") {
    return forbidden(c)
  }

  const origin = c.req.header("origin")
  if (origin && !trustedOrigins().has(origin)) {
    return forbidden(c)
  }

  await next()
})

export async function canOpenPasskeyRegistration(): Promise<boolean> {
  return (
    configStore.get("openRegistrations") && configStore.get("passkeyEnabled")
  )
}

export function authError(
  c: Context,
  status: 403 | 409,
  code: AuthErrorCode,
  message: string,
) {
  return c.json({ error: { code, message } }, status)
}

export function authenticatedSignInResponse(
  c: Context,
  result: AuthenticatedSignInResult,
) {
  if (result.kind === "session") {
    return c.json(publicSessionData(result.session.data))
  }
  if (result.kind === "reactivation-required") {
    return authError(
      c,
      409,
      AUTH_ERROR_CODES.accountReactivationRequired,
      "Reactivate your account to finish signing in.",
    )
  }
  return authError(
    c,
    403,
    AUTH_ERROR_CODES.accountBanned,
    "This account has been banned by an administrator.",
  )
}
