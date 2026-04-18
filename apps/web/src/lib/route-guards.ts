import { redirect } from "@tanstack/react-router"

import { authClient } from "./auth-client"

/**
 * Route-guard helpers. Call these from a route's `beforeLoad` so the redirect
 * happens before the loader (and therefore before any child loaders) runs.
 *
 * These are strictly UX guards — the server still enforces authorization on
 * every admin endpoint. If the client guard is bypassed somehow the user
 * just hits a 401/403 from the API.
 */

type Session = Awaited<ReturnType<typeof authClient.getSession>>["data"]

async function getSession(): Promise<Session> {
  const { data } = await authClient.getSession()
  return data
}

/** Redirects to /login if no session. Returns the session otherwise. */
export async function requireAuth(): Promise<NonNullable<Session>> {
  const session = await getSession()
  if (!session) {
    throw redirect({ to: "/login" })
  }
  return session
}

/**
 * Redirects to /login when unauthenticated and to / when signed in but not
 * an admin. Returns the session for convenience.
 */
export async function requireAdmin(): Promise<NonNullable<Session>> {
  const session = await requireAuth()
  const role = (session.user as { role?: string }).role
  if (role !== "admin") {
    throw redirect({ to: "/" })
  }
  return session
}
