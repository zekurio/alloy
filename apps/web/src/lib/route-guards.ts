import { redirect } from "@tanstack/react-router"
import { getRequestHeaders } from "@tanstack/react-start/server"

import { authClient } from "./auth-client"
import { fetchAuthConfig } from "./auth-config"

/**
 * Route-guard helpers. Call these from a route's `beforeLoad` so the redirect
 * happens before the loader (and therefore before any child loaders) runs.
 *
 * These are strictly UX guards — the server still enforces authorization on
 * every admin endpoint. If the client guard is bypassed somehow the user
 * just hits a 401/403 from the API.
 *
 * SSR note: TanStack Start runs `beforeLoad` on the server too. Better-auth's
 * session lives in a cookie, so to resolve it during SSR we forward the
 * incoming request's `Cookie` header to the API fetch. Without that
 * forwarding the server-side fetch would always report "signed out" and the
 * resolved context (cached and shipped to the client) would leak
 * unauthenticated renders — `beforeLoad` does not re-run on hydration.
 */

const isBrowser = typeof window !== "undefined"

type Session = Awaited<ReturnType<typeof authClient.getSession>>["data"]

/**
 * Resolve the current session, forwarding the request cookie on SSR so the
 * API can actually look the session up. On the client, cookies travel with
 * the fetch automatically thanks to `credentials: "include"`.
 */
async function getSession(): Promise<Session> {
  if (isBrowser) {
    const { data } = await authClient.getSession()
    return data
  }
  const cookie = getRequestHeaders().get("cookie") ?? ""
  // If there's no cookie header at all there's definitely no session — skip
  // the round-trip. (Also avoids noise in server logs on public routes.)
  if (!cookie) return null
  const { data } = await authClient.getSession({
    fetchOptions: { headers: { cookie } },
  })
  return data
}

/**
 * Inverse of `requireAuth` — sends already-signed-in users away from
 * auth-only surfaces like /login or /setup so they don't see a sign-in form
 * while holding a valid session.
 */
export async function redirectIfAuthed(to: string = "/"): Promise<void> {
  const session = await getSession()
  if (session) {
    throw redirect({ to })
  }
}

/**
 * Redirects to /setup on a fresh install (no users yet), to /login if there's
 * no session, and otherwise returns the resolved session.
 *
 * The `setupRequired` check is folded in here so every authed surface
 * (including `/`) routes fresh instances straight to onboarding instead of
 * bouncing through `/login` first.
 */
export async function requireAuth(): Promise<NonNullable<Session>> {
  // Kick both requests off in parallel — they're independent and this is on
  // the critical path of every authed navigation.
  const [session, config] = await Promise.all([
    getSession(),
    fetchAuthConfig(),
  ])
  if (config.setupRequired) {
    throw redirect({ to: "/setup" })
  }
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
