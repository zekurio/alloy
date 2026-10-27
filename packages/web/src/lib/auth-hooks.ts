import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { isAdmin, shouldForceOnboarding } from "./auth-access"
import {
  type Session,
  useSuspenseAuthConfig,
  useSuspenseSession,
} from "./session-suspense"

/** Reactive admin flag. Suspends on first fetch. */
export function useIsAdmin(): boolean {
  return isAdmin(useSuspenseSession())
}

export function useRequireAuthStrict(): Session | null {
  const session = useSuspenseSession()
  const config = useSuspenseAuthConfig()
  const navigate = useNavigate()

  const target =
    config.adminAccountRequired || shouldForceOnboarding(config, session)
      ? "/setup"
      : session
        ? null
        : "/login"

  // The settings dialog opens over unguarded routes too, so a session that
  // ends while it is open has no route guard to move it on.
  useEffect(() => {
    if (target) void navigate({ to: target, replace: true })
  }, [target, navigate])

  return target ? null : session
}

/**
 * Whether the login and sign-up pages should render. Their `beforeLoad`
 * redirects a signed-in visitor, and every sign-in invalidates the router, so
 * the guard also moves the page on once a sign-in lands here.
 */
export function useSignedOut(): boolean {
  return !useSuspenseSession()
}
