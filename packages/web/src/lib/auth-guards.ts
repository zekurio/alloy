import type { PublicAuthConfig } from "@alloy/api"
import { redirect } from "@tanstack/react-router"

import { sanitizeLoginRedirect } from "./login-redirect"
import { loadAuthConfig, loadSession, type Session } from "./session-suspense"

type AuthRouteContext = {
  authConfig: PublicAuthConfig
  session: Session | null
}

/**
 * Root guard. Runs before every child route's guard, so those only need the
 * session it puts on the context: a server without an admin has already been
 * redirected to `/setup` here.
 */
export async function redirectToSetupBeforeLoad({
  location,
}: {
  location: { pathname: string }
}): Promise<AuthRouteContext> {
  if (location.pathname === "/setup") {
    return { authConfig: await loadAuthConfig(), session: null }
  }

  const configPromise = loadAuthConfig()
  const sessionPromise = loadSession()
  const config = await configPromise
  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }
  return { authConfig: config, session: await sessionPromise }
}

export function requireStrictAuthBeforeLoad({
  context,
}: {
  context: AuthRouteContext
}) {
  if (!context.session) {
    throw redirect({ to: "/login" })
  }
}

export function redirectAuthedBeforeLoad({
  context,
  search,
}: {
  context: AuthRouteContext
  search?: { redirect?: string }
}) {
  if (context.session) {
    // Already signed in: honor a same-origin redirect target (the desktop
    // browser-login handshake returns to its confirmation page here) before
    // falling back to home.
    const target = sanitizeLoginRedirect(search?.redirect)
    if (target) throw redirect({ href: target })
    throw redirect({ to: "/" })
  }
}
