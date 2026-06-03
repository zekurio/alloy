import { use } from "react"
import { useRouterState } from "@tanstack/react-router"

import type { PublicAuthConfig } from "@workspace/api"

import { api } from "./api"
import { authClient, useSession } from "./auth-client"
import { clientLogger } from "./client-log"

type SessionData = ReturnType<typeof useSession>["data"]

export type Session = NonNullable<SessionData>

type RouteSessionState = {
  found: boolean
  data: SessionData
}

type RouteAuthConfigState = {
  found: boolean
  data: PublicAuthConfig | null
}

let sessionInitialPromise: Promise<void> | null = null
let configPromiseCache: Promise<PublicAuthConfig> | null = null
let sessionLoadWarningLogged = false

function useRouteSession(): RouteSessionState {
  return useRouterState({
    select: (state): RouteSessionState => {
      for (let i = state.matches.length - 1; i >= 0; i -= 1) {
        const context = state.matches[i]?.context as
          | { session?: SessionData }
          | undefined
        if (
          context &&
          Object.prototype.hasOwnProperty.call(context, "session")
        ) {
          return { found: true, data: context.session ?? null }
        }
      }
      return { found: false, data: null }
    },
  })
}

function useRouteAuthConfig(): RouteAuthConfigState {
  return useRouterState({
    select: (state): RouteAuthConfigState => {
      for (let i = state.matches.length - 1; i >= 0; i -= 1) {
        const context = state.matches[i]?.context as
          | { authConfig?: PublicAuthConfig }
          | undefined
        if (
          context &&
          Object.prototype.hasOwnProperty.call(context, "authConfig")
        ) {
          return { found: true, data: context.authConfig ?? null }
        }
      }
      return { found: false, data: null }
    },
  })
}

function sessionInitializedPromise(): Promise<void> {
  if (sessionInitialPromise) return sessionInitialPromise

  if (typeof window === "undefined") {
    sessionInitialPromise = Promise.resolve()
    return sessionInitialPromise
  }

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

export async function loadSession(): Promise<SessionData> {
  if (typeof window === "undefined") return null
  try {
    const { data } = await authClient.getSession()
    return data
  } catch (cause) {
    if (!sessionLoadWarningLogged) {
      sessionLoadWarningLogged = true
      clientLogger.warn(
        "[auth] Failed to load session; using anonymous state.",
        cause,
      )
    }
    return null
  }
}

/**
 * Read the public auth config inlined into the document by the server (see
 * `web.ts`). Consumed once: after an invalidation we must re-fetch rather than
 * reuse the now-stale boot snapshot.
 */
function readBootstrapAuthConfig(): PublicAuthConfig | null {
  const holder = globalThis as { __ALLOY_PUBLIC_CONFIG__?: PublicAuthConfig }
  const config = holder.__ALLOY_PUBLIC_CONFIG__
  if (!config) return null
  delete holder.__ALLOY_PUBLIC_CONFIG__
  return config
}

export function loadAuthConfig(): Promise<PublicAuthConfig> {
  if (typeof window === "undefined") {
    return api.authConfig.fetch()
  }

  if (!configPromiseCache) {
    const bootstrap = readBootstrapAuthConfig()
    configPromiseCache = bootstrap
      ? Promise.resolve(bootstrap)
      : api.authConfig.fetch().catch((err) => {
        configPromiseCache = null
        throw err
      })
  }
  return configPromiseCache
}

export function invalidateAuthConfig(): void {
  configPromiseCache = null
}

export function useSuspenseSession(): SessionData {
  const routeSession = useRouteSession()
  if (routeSession.found) return routeSession.data

  if (typeof window === "undefined") {
    return null
  }

  use(sessionInitializedPromise())
  const { data } = useSession()
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
