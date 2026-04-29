import type { PublicAuthConfig } from "@workspace/api"

import { devFlags } from "./flags"
import type { Session } from "./session-suspense"

export type AuthRouteTarget = "/setup" | "/login" | null

export function isAdmin(session: Session | null): boolean {
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

export function isClipPermalink(pathname: string): boolean {
  return /^\/g\/[^/]+\/c\/[^/]+\/?$/.test(pathname)
}

export function shouldForceOnboarding(
  config: PublicAuthConfig,
  session: Session | null
): boolean {
  return (
    (config.setupRequired || devFlags.forceOnboarding) &&
    !config.adminAccountRequired &&
    isAdmin(session)
  )
}

export function browseAuthTarget(
  session: Session | null,
  config: PublicAuthConfig,
  pathname: string
): AuthRouteTarget {
  if (config.adminAccountRequired) return "/setup"
  if (shouldForceOnboarding(config, session)) return "/setup"
  if (isClipPermalink(pathname)) return null
  if (!session && config.requireAuthToBrowse) return "/login"
  return null
}
