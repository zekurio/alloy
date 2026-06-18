import type { PublicAuthConfig } from "@alloy/api"

import type { Session } from "./session-suspense"

type AuthRouteTarget = "/setup" | "/login" | null

export function isAdmin(session: Session | null): boolean {
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

function isClipPermalink(pathname: string): boolean {
  return /^\/(?:g|games)\/[^/]+\/c\/[^/]+\/?$/.test(pathname)
}

export function shouldForceOnboarding(
  config: PublicAuthConfig,
  session: Session | null,
): boolean {
  return (
    config.setupRequired && !config.adminAccountRequired && isAdmin(session)
  )
}

export function browseAuthTarget(
  session: Session | null,
  config: PublicAuthConfig,
  pathname: string,
): AuthRouteTarget {
  if (config.adminAccountRequired) return "/setup"
  if (shouldForceOnboarding(config, session)) return "/setup"
  if (isClipPermalink(pathname)) return null
  if (!session && config.requireAuthToBrowse) return "/login"
  return null
}
