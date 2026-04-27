import { redirect } from "@tanstack/react-router"

import type { PublicAuthConfig } from "@workspace/api"

import { devFlags } from "./flags"
import { loadAuthConfig, loadSession, type Session } from "./session-suspense"

type AuthRouteContext = {
  authConfig?: PublicAuthConfig
  session?: Session | null
}

function isAdmin(session: Session | null): boolean {
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

function isClipPermalink(pathname: string): boolean {
  return /^\/g\/[^/]+\/c\/[^/]+\/?$/.test(pathname)
}

function authContext(config: PublicAuthConfig, session: Session | null) {
  return { authConfig: config, session }
}

function shouldForceOnboarding(
  config: PublicAuthConfig,
  session: Session | null
) {
  return devFlags.forceOnboarding && !config.setupRequired && isAdmin(session)
}

function contextSession(context: AuthRouteContext): Session | null | undefined {
  if (Object.prototype.hasOwnProperty.call(context, "session")) {
    return context.session ?? null
  }
  return undefined
}

function loadContextAuthConfig(context: AuthRouteContext) {
  return context.authConfig
    ? Promise.resolve(context.authConfig)
    : loadAuthConfig()
}

function loadContextSession(context: AuthRouteContext) {
  const session = contextSession(context)
  return session !== undefined ? Promise.resolve(session) : loadSession()
}

export async function redirectToSetupBeforeLoad({
  location,
}: {
  location: { pathname: string }
}) {
  if (location.pathname === "/setup") {
    return authContext(await loadAuthConfig(), null)
  }

  const config = await loadAuthConfig()
  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }
  const session = await loadSession()
  if (shouldForceOnboarding(config, session)) {
    throw redirect({ to: "/setup" })
  }
  return authContext(config, session)
}

export async function requireBrowseAuthBeforeLoad({
  context,
  location,
}: {
  context: AuthRouteContext
  location: { pathname: string }
}) {
  const config = await loadContextAuthConfig(context)

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  const session = await loadContextSession(context)
  if (shouldForceOnboarding(config, session)) {
    throw redirect({ to: "/setup" })
  }

  if (isClipPermalink(location.pathname)) {
    return authContext(config, session)
  }

  if (!session && config.requireAuthToBrowse) {
    throw redirect({ to: "/login" })
  }
  return authContext(config, session)
}

export async function requireStrictAuthBeforeLoad({
  context,
}: {
  context: AuthRouteContext
}) {
  const [config, session] = await Promise.all([
    loadContextAuthConfig(context),
    loadContextSession(context),
  ])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (shouldForceOnboarding(config, session)) {
    throw redirect({ to: "/setup" })
  }

  if (!session) {
    throw redirect({ to: "/login" })
  }
  return authContext(config, session)
}

export async function requireAdminBeforeLoad({
  context,
}: {
  context: AuthRouteContext
}) {
  const [config, session] = await Promise.all([
    loadContextAuthConfig(context),
    loadContextSession(context),
  ])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (shouldForceOnboarding(config, session)) {
    throw redirect({ to: "/setup" })
  }

  if (!session) {
    throw redirect({ to: "/login" })
  }

  if (!isAdmin(session)) {
    throw redirect({ to: "/" })
  }
  return authContext(config, session)
}

export async function redirectAuthedBeforeLoad({
  context,
}: {
  context: AuthRouteContext
}) {
  const [config, session] = await Promise.all([
    loadContextAuthConfig(context),
    loadContextSession(context),
  ])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (shouldForceOnboarding(config, session)) {
    throw redirect({ to: "/setup" })
  }

  if (session) {
    throw redirect({ to: "/" })
  }
  return authContext(config, session)
}
