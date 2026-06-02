import * as React from "react"
import { useLocation, useNavigate } from "@tanstack/react-router"

import {
  type Session,
  useSuspenseAuthConfig,
  useSuspenseSession,
} from "./session-suspense"
import { browseAuthTarget, isAdmin, shouldForceOnboarding } from "./auth-access"

/** Reactive admin flag. Suspends on first fetch. */
export function useIsAdmin(): boolean {
  return isAdmin(useSuspenseSession())
}

export function useRequireAuth(): Session | null {
  const { allowed, session } = useBrowseAuthGate()
  return allowed ? session : null
}

export function useBrowseAuthGate(): {
  allowed: boolean
  session: Session | null
} {
  const session = useSuspenseSession()
  const config = useSuspenseAuthConfig()
  const navigate = useNavigate()
  const location = useLocation()

  const target = browseAuthTarget(session, config, location.pathname)

  React.useEffect(() => {
    if (target) void navigate({ to: target, replace: true })
  }, [target, navigate])

  return { allowed: target === null, session }
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

  React.useEffect(() => {
    if (target) void navigate({ to: target, replace: true })
  }, [target, navigate])

  return target ? null : session
}

export function useRedirectIfAuthed(to: string = "/"): boolean {
  const session = useSuspenseSession()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (session) void navigate({ to, replace: true })
  }, [session, to, navigate])

  return !session
}
