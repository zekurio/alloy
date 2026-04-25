import { redirect } from "@tanstack/react-router"

import { loadAuthConfig, loadSession, type Session } from "./session-suspense"

function isAdmin(session: Session | null): boolean {
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

function isClipPermalink(pathname: string): boolean {
  return /^\/g\/[^/]+\/c\/[^/]+\/?$/.test(pathname)
}

function authContext(
  config: Awaited<ReturnType<typeof loadAuthConfig>>,
  session: Session | null
) {
  return { authConfig: config, session }
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
  return authContext(config, session)
}

export async function requireBrowseAuthBeforeLoad({
  location,
}: {
  location: { pathname: string }
}) {
  const config = await loadAuthConfig()

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  const session = await loadSession()
  if (isClipPermalink(location.pathname)) {
    return authContext(config, session)
  }

  if (!session && config.requireAuthToBrowse) {
    throw redirect({ to: "/login" })
  }
  return authContext(config, session)
}

export async function requireStrictAuthBeforeLoad() {
  const [config, session] = await Promise.all([loadAuthConfig(), loadSession()])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (!session) {
    throw redirect({ to: "/login" })
  }
  return authContext(config, session)
}

export async function requireAdminBeforeLoad() {
  const [config, session] = await Promise.all([loadAuthConfig(), loadSession()])

  if (config.setupRequired) {
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

export async function redirectAuthedBeforeLoad() {
  const [config, session] = await Promise.all([loadAuthConfig(), loadSession()])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (session) {
    throw redirect({ to: "/" })
  }
  return authContext(config, session)
}
