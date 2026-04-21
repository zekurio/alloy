import { use } from "react"

import { authClient, useSession } from "./auth-client"
import { fetchAuthConfig, type PublicAuthConfig } from "./auth-config"

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
  requireAuthToBrowse: true,
  provider: null,
}

let sessionInitialPromise: Promise<void> | null = null
let configPromiseCache: Promise<PublicAuthConfig> | null = null

function sessionInitializedPromise(): Promise<void> {
  if (sessionInitialPromise) return sessionInitialPromise

  if (typeof window === "undefined") {
    sessionInitialPromise = Promise.resolve()
    return sessionInitialPromise
  }

  const atom = authClient.$store.atoms.session as
    | { get(): AtomValue; listen(cb: (v: AtomValue) => void): () => void }
    | undefined

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

function configPromise(): Promise<PublicAuthConfig> {
  if (typeof window === "undefined") {
    return Promise.resolve(FALLBACK_CONFIG)
  }
  if (!configPromiseCache) {
    configPromiseCache = fetchAuthConfig().catch(() => FALLBACK_CONFIG)
  }
  return configPromiseCache
}

export function invalidateAuthConfig(): void {
  configPromiseCache = null
}

export function useSuspenseSession(): SessionData {
  use(sessionInitializedPromise())
  const { data } = useSession()
  return data
}

/**
 * Suspends until the public auth-config probe resolves. Shared cache
 * across routes — cheap to call from multiple components on the same page.
 */
export function useSuspenseAuthConfig(): PublicAuthConfig {
  return use(configPromise())
}
