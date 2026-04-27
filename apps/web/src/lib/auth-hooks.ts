import * as React from "react"
import { useNavigate } from "@tanstack/react-router"

import {
  useSuspenseAuthConfig,
  useSuspenseSession,
  type Session,
} from "./session-suspense"
import { devFlags } from "./flags"

function isAdmin(session: Session | null): boolean {
  return (session?.user as { role?: string } | undefined)?.role === "admin"
}

function browseAuthTarget(
  session: Session | null,
  config: ReturnType<typeof useSuspenseAuthConfig>
): "/setup" | "/login" | null {
  if (config.setupRequired) return "/setup"
  if (devFlags.forceOnboarding && isAdmin(session)) return "/setup"
  if (!session && config.requireAuthToBrowse) return "/login"
  return null
}

export function useAuth(): Session | null {
  return useSuspenseSession()
}

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

  const target = browseAuthTarget(session, config)

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
    config.setupRequired || (devFlags.forceOnboarding && isAdmin(session))
      ? "/setup"
      : session
        ? null
        : "/login"

  React.useEffect(() => {
    if (target) void navigate({ to: target, replace: true })
  }, [target, navigate])

  return target ? null : session
}

export function useRequireAdmin(): Session | null {
  const session = useRequireAuthStrict()
  const navigate = useNavigate()
  const allowed = session ? isAdmin(session) : true

  React.useEffect(() => {
    if (session && !allowed) {
      void navigate({ to: "/", replace: true })
    }
  }, [session, allowed, navigate])

  return session && allowed ? session : null
}

export function useRedirectIfAuthed(to: string = "/"): boolean {
  const session = useSuspenseSession()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (session) void navigate({ to, replace: true })
  }, [session, to, navigate])

  return !session
}
