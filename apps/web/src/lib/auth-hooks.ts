import * as React from "react"
import { useNavigate } from "@tanstack/react-router"

import {
  useSuspenseAuthConfig,
  useSuspenseSession,
  type Session,
} from "./session-suspense"

/**
 * Hook-based auth/admin guards, built on better-auth's reactive session atom
 * (exposed as the Suspense-friendly `useSuspenseSession` / `useSuspenseAuthConfig`
 * in `session-suspense.ts`). These replace the previous `beforeLoad`-based
 * guards — those leaned on `@tanstack/react-start/server` to forward the
 * incoming `Cookie` header during SSR, which is a server-only import that
 * now hard-errors when loaded into the client bundle.
 *
 * The hooks suspend on first mount (streaming a fallback on SSR and while
 * the client atom fires its first `/get-session`) and kick off navigation
 * via `useNavigate` in an effect when the visitor isn't allowed in. Every
 * redirect is strictly UX — the server still re-authorises every request.
 */

function isAdmin(session: Session | null): boolean {
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

/**
 * Reactive session, suspending until the first fetch settles. Returns `null`
 * when signed out — callers that only want to branch on role should prefer
 * `useIsAdmin`.
 */
export function useAuth(): Session | null {
  return useSuspenseSession()
}

/** Reactive admin flag. Suspends on first fetch. */
export function useIsAdmin(): boolean {
  return isAdmin(useSuspenseSession())
}

/**
 * Protected-route guard. Suspends until the session and the public
 * auth-config probe have resolved, then navigates to `/setup` (fresh
 * install) or `/login` (no session) when applicable.
 *
 * Returns the session when the consumer is allowed to render, otherwise
 * `null` to signal "we're on our way out — render nothing".
 */
export function useRequireAuth(): Session | null {
  const session = useSuspenseSession()
  const config = useSuspenseAuthConfig()
  const navigate = useNavigate()

  // Resolve the eventual redirect target synchronously so the returned value
  // is consistent with the effect below (the effect can only fire redirects,
  // not unmount the caller — callers still need to short-circuit rendering).
  const target = config.setupRequired ? "/setup" : session ? null : "/login"

  React.useEffect(() => {
    if (target) void navigate({ to: target, replace: true })
  }, [target, navigate])

  return target ? null : session
}

/**
 * Admin-only guard. Builds on `useRequireAuth` and additionally bounces
 * signed-in non-admins to `/`. Every admin endpoint on the API re-verifies
 * this server-side.
 */
export function useRequireAdmin(): Session | null {
  const session = useRequireAuth()
  const navigate = useNavigate()
  const allowed = session ? isAdmin(session) : true

  React.useEffect(() => {
    if (session && !allowed) {
      void navigate({ to: "/", replace: true })
    }
  }, [session, allowed, navigate])

  return session && allowed ? session : null
}

/**
 * Inverse guard for auth-only surfaces like `/login` and `/setup`. Suspends
 * until the first session fetch settles, then sends already-signed-in
 * visitors away so they don't see the sign-in form while holding a session.
 * Returns `true` when the current visitor may render the page.
 */
export function useRedirectIfAuthed(to: string = "/"): boolean {
  const session = useSuspenseSession()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (session) void navigate({ to, replace: true })
  }, [session, to, navigate])

  return !session
}
