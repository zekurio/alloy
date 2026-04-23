import { cache, use } from "react"
import { createMiddleware, createServerFn } from "@tanstack/react-start"

import type { PublicAuthConfig } from "@workspace/api"

import { api } from "./api"
import { authClient, useSession } from "./auth-client"
import { apiOrigin } from "./env"

type SessionData = ReturnType<typeof useSession>["data"]

export type Session = NonNullable<SessionData>

type AtomValue = {
  data: SessionData
  isPending: boolean
}

const FALLBACK_CONFIG: PublicAuthConfig = {
  setupRequired: false,
  openRegistrations: false,
  emailPasswordEnabled: true,
  passkeyEnabled: true,
  requireAuthToBrowse: true,
  provider: null,
}

let sessionInitialPromise: Promise<void> | null = null
let configPromiseCache: Promise<PublicAuthConfig> | null = null

const requestContextMiddleware = createMiddleware().server(
  ({ next, request }) => {
    return next({ context: { request } })
  }
)

async function fetchSession(cookie: string | null): Promise<SessionData> {
  try {
    const response = await fetch(new URL("/api/auth/get-session", apiOrigin()), {
      headers: cookie ? { cookie } : undefined,
    })

    if (!response.ok) return null

    return (await response.json()) as SessionData
  } catch {
    return null
  }
}

const fetchServerSession = createServerFn({ method: "GET" })
  .middleware([requestContextMiddleware])
  .handler(async ({ context }) => {
    return fetchSession(context.request.headers.get("cookie"))
  })

const loadServerSession = cache(() => fetchServerSession())

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
  if (typeof window === "undefined") return loadServerSession()

  const current = sessionAtom()?.get()
  if (current && !current.isPending) return current.data

  try {
    const { data } = await authClient.getSession()
    return data ?? null
  } catch {
    return null
  }
}

export function loadAuthConfig(): Promise<PublicAuthConfig> {
  if (!configPromiseCache) {
    configPromiseCache = api.authConfig.fetch().catch(() => FALLBACK_CONFIG)
  }
  return configPromiseCache
}

export function invalidateAuthConfig(): void {
  configPromiseCache = null
}

export function useSuspenseSession(): SessionData {
  if (typeof window === "undefined") {
    return use(loadServerSession())
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
