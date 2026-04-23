import { redirect } from "@tanstack/react-router"

import { loadAuthConfig, loadSession, type Session } from "./session-suspense"

function isAdmin(session: Session | null): boolean {
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

export async function requireBrowseAuthBeforeLoad(): Promise<void> {
  const [config, session] = await Promise.all([
    loadAuthConfig(),
    loadSession(),
  ])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (!session && config.requireAuthToBrowse) {
    throw redirect({ to: "/login" })
  }
}

export async function requireStrictAuthBeforeLoad(): Promise<void> {
  const [config, session] = await Promise.all([
    loadAuthConfig(),
    loadSession(),
  ])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (!session) {
    throw redirect({ to: "/login" })
  }
}

export async function requireAdminBeforeLoad(): Promise<void> {
  const [config, session] = await Promise.all([
    loadAuthConfig(),
    loadSession(),
  ])

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
  const [config, session] = await Promise.all([
    loadAuthConfig(),
    loadSession(),
  ])

  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }

  if (session) {
    throw redirect({ to: "/" })
  }
}
