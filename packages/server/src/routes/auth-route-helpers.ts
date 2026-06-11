import { configStore } from "@alloy/server/config/store"
import { env } from "@alloy/server/env"
import { forbidden } from "@alloy/server/runtime/http-response"
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

  const allowedOrigins = trustedOrigins()
  const origin = c.req.header("origin")
  if (origin && !allowedOrigins.has(origin)) {
    return forbidden(c)
  }

  const fetchSite = c.req.header("sec-fetch-site")
  if (fetchSite === "cross-site" || fetchSite === "none") {
    return forbidden(c)
  }

  await next()
})

export async function canOpenPasskeyRegistration(): Promise<boolean> {
  return (
    configStore.get("openRegistrations") && configStore.get("passkeyEnabled")
  )
}
