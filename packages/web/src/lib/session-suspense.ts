import type { PublicAuthConfig } from "@alloy/api"
import { setServerThemeAccents } from "@alloy/ui/lib/theme"
import { useRouterState } from "@tanstack/react-router"
import { use } from "react"

import { api } from "./api"
import { authClient, useSession } from "./auth-client"
import { clientLogger } from "./client-log"

type SessionData = ReturnType<typeof useSession>["data"]

export type Session = NonNullable<SessionData>

type RouteAuthContext = {
  session?: SessionData
  authConfig?: PublicAuthConfig
}

type RouteSessionState = {
  found: boolean
  data: SessionData
}

type RouteAuthConfigState = {
  found: boolean
  data: PublicAuthConfig | null
}

let sessionInitialPromise: Promise<void> | null = null
let sessionRetryPromise: Promise<SessionData> | null = null
let configPromiseCache: Promise<PublicAuthConfig> | null = null
let sessionLoadWarningLogged = false

/** The deepest route context that carries `key`, set by the root guard. */
function routeAuthContext(
  matches: ReadonlyArray<{ context?: unknown }>,
  key: keyof RouteAuthContext,
): RouteAuthContext | null {
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    // SAFETY: Route matches carry the root context that defines these keys.
    const context = matches[i]?.context as RouteAuthContext | undefined
    if (context && Object.hasOwn(context, key)) return context
  }
  return null
}

function useRouteSession(): RouteSessionState {
  return useRouterState({
    select: (state): RouteSessionState => {
      const context = routeAuthContext(state.matches, "session")
      return { found: context !== null, data: context?.session ?? null }
    },
  })
}

function useRouteAuthConfig(): RouteAuthConfigState {
  return useRouterState({
    select: (state): RouteAuthConfigState => {
      const context = routeAuthContext(state.matches, "authConfig")
      return { found: context !== null, data: context?.authConfig ?? null }
    },
  })
}

function sessionInitializedPromise(): Promise<void> {
  if (sessionInitialPromise) return sessionInitialPromise

  const current = authClient.$store.getSnapshot()
  if (!current.isPending) {
    sessionInitialPromise = Promise.resolve()
    return sessionInitialPromise
  }

  sessionInitialPromise = new Promise<void>((resolve) => {
    const unsubscribe = authClient.$store.subscribe(() => {
      const value = authClient.$store.getSnapshot()
      if (!value.isPending) {
        unsubscribe()
        resolve()
      }
    })
  })
  return sessionInitialPromise
}

/**
 * Resolve the current session without forcing a network round trip. The auth
 * client store fetches once at boot, and every auth action (sign-in, sign-out,
 * profile update) writes back into it — so route guards, which run on every
 * navigation *and* hover-preload, can reuse the settled snapshot. Only a
 * failed fetch triggers a refetch, shared across concurrent callers.
 */
export async function loadSession(): Promise<SessionData> {
  await sessionInitializedPromise()
  const snapshot = authClient.$store.getSnapshot()
  if (!snapshot.error) return snapshot.data

  if (!sessionRetryPromise) {
    sessionRetryPromise = authClient.$store
      .refetch()
      .then(({ data }) => data)
      .catch((cause: unknown) => {
        if (!sessionLoadWarningLogged) {
          sessionLoadWarningLogged = true
          clientLogger.warn(
            "[auth] Failed to load session; using anonymous state.",
            cause,
          )
        }
        return null
      })
      .finally(() => {
        sessionRetryPromise = null
      })
  }
  return sessionRetryPromise
}

/**
 * Read the public auth config inlined into the document by the server (see
 * `web.ts`). Consumed once: after an invalidation we must re-fetch rather than
 * reuse the now-stale boot snapshot.
 */
function readBootstrapAuthConfig(): PublicAuthConfig | null {
  // SAFETY: The server writes this optional global from PublicAuthConfig.
  const holder = globalThis as { __ALLOY_PUBLIC_CONFIG__?: PublicAuthConfig }
  const config = holder.__ALLOY_PUBLIC_CONFIG__
  if (!config) return null
  delete holder.__ALLOY_PUBLIC_CONFIG__
  return config
}

export function loadAuthConfig(): Promise<PublicAuthConfig> {
  if (!configPromiseCache) {
    const bootstrap = readBootstrapAuthConfig()
    const load = bootstrap
      ? Promise.resolve(bootstrap)
      : api.authConfig.fetch().catch((err) => {
          configPromiseCache = null
          throw err
        })
    // The server's theme accents ship with this config, so every load (boot,
    // and the reload after an admin edits them) keeps the page's accent current.
    configPromiseCache = load.then((config) => {
      setServerThemeAccents(config.accentColors)
      return config
    })
  }
  return configPromiseCache
}

export function invalidateAuthConfig(): void {
  configPromiseCache = null
}

export function useSuspenseSession(): SessionData {
  const routeSession = useRouteSession()
  const { data } = useSession()
  if (routeSession.found) return routeSession.data

  use(sessionInitializedPromise())
  return data
}

/**
 * Suspends until the public auth-config probe resolves. Shared cache
 * across routes — cheap to call from multiple components on the same page.
 */
export function useSuspenseAuthConfig(): PublicAuthConfig {
  const routeAuthConfig = useRouteAuthConfig()
  if (routeAuthConfig.found && routeAuthConfig.data) {
    return routeAuthConfig.data
  }

  return use(loadAuthConfig())
}
