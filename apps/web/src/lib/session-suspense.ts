import { cache, use } from "react"
import { useRouterState } from "@tanstack/react-router"

import type { PublicAuthConfig } from "@workspace/api"

import { api } from "./api"
import { authClient, useSession } from "./auth-client"
import { fetchCurrentServerSession } from "./session-server"

type SessionData = ReturnType<typeof useSession>["data"]

export type Session = NonNullable<SessionData>

type AtomValue = {
  data: SessionData
  isPending: boolean
}

type RouteSessionState = {
  found: boolean
  data: SessionData
}

let sessionInitialPromise: Promise<void> | null = null
let configPromiseCache: Promise<PublicAuthConfig> | null = null

const loadServerSession = cache(() => fetchCurrentServerSession())

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

function sessionAtom():
  | { get(): AtomValue; listen(cb: (v: AtomValue) => void): () => void }
  | undefined {
  const atom = authClient.$store.atoms.session as
    | { get(): AtomValue; listen(cb: (v: AtomValue) => void): () => void }
    | undefined

  return atom
}

function sessionInitializedPromise(): Promise<void> {
  if (sessionInitialPromise) return sessionInitialPromise

  if (typeof window === "undefined") {
    sessionInitialPromise = Promise.resolve()
    return sessionInitialPromise
  }

  const atom = sessionAtom()

  if (!atom) {
    // Shouldn't happen with our client config, but fail open rather than
    // suspending forever.
    sessionInitialPromise = Promise.resolve()
    return sessionInitialPromise
  }

  const current = atom.get()
  if (current && !current.isPending) {
    sessionInitialPromise = Promise.resolve()
    return sessionInitialPromise
  }

  sessionInitialPromise = new Promise<void>((resolve) => {
    const unsubscribe = atom.listen((value) => {
      if (!value.isPending) {
        unsubscribe()
        resolve()
      }
    })
  })
  return sessionInitialPromise
}

export async function loadSession(): Promise<SessionData> {
  return loadServerSession()
}

export function loadAuthConfig(): Promise<PublicAuthConfig> {
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
  return use(loadAuthConfig())
}
