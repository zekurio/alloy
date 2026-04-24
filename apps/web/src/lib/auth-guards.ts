import { redirect } from "@tanstack/react-router"

import { loadAuthConfig, loadSession, type Session } from "./session-suspense"

function isAdmin(session: Session | null): boolean {
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

function isClipPermalink(pathname: string): boolean {
  return /^\/g\/[^/]+\/c\/[^/]+\/?$/.test(pathname)
}

export async function redirectToSetupBeforeLoad({
  location,
}: {
  location: { pathname: string }
}): Promise<void> {
  if (location.pathname === "/setup") return

  const config = await loadAuthConfig()
  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }
}

export async function requireBrowseAuthBeforeLoad({
  location,
}: {
  location: { pathname: string }
}): Promise<void> {
  const config = await loadAuthConfig()

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (isClipPermalink(location.pathname)) return

  const session = await loadSession()
  if (!session && config.requireAuthToBrowse) {
    throw redirect({ to: "/login" })
  }
}

export async function requireStrictAuthBeforeLoad(): Promise<void> {
  const [config, session] = await Promise.all([loadAuthConfig(), loadSession()])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (!session) {
    throw redirect({ to: "/login" })
  }
}

export async function requireAdminBeforeLoad(): Promise<void> {
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
}

export async function redirectAuthedBeforeLoad(): Promise<void> {
  const [config, session] = await Promise.all([loadAuthConfig(), loadSession()])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (session) {
    throw redirect({ to: "/" })
  }
}
