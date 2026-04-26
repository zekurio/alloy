import { use } from "react"
import { useRouterState } from "@tanstack/react-router"

import type { PublicAuthConfig } from "@workspace/api"

import { api } from "./api"
import { authClient, useSession } from "./auth-client"

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
  } catch {
    return null
  }
}

export function loadAuthConfig(): Promise<PublicAuthConfig> {
  if (typeof window === "undefined") {
    return api.authConfig.fetch()
  }

  if (!configPromiseCache) {
    configPromiseCache = api.authConfig.fetch().catch((err) => {
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
