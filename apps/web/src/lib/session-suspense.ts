import { use } from "react"

import { authClient, useSession } from "./auth-client"
import { fetchAuthConfig, type PublicAuthConfig } from "./auth-config"

/**
 * Suspense-compatible wrappers around the auth client's reactive session
 * atom and the public `/auth-config` probe, so route guards and user chrome
 * can surface a proper skeleton during the initial fetch instead of
 * flashing a placeholder before the real data arrives.
 *
 * The design intentionally only *suspends* on the first resolution — after
 * that, consumers fall through to the reactive `useSession()` hook so
 * cross-tab sign-in / sign-out still propagate without ever showing the
 * fallback again. Re-suspending every session refresh would blank the app
 * on every "stay logged in" ping.
 *
 * SSR: the protected surfaces are strictly client-rendered (the session
 * lives in an httpOnly cookie we deliberately don't forward through
 * TanStack Start to avoid a server-only import). On the server both
 * promises resolve synchronously to a signed-out / fallback shape — we
 * can't read the session there anyway, so we render the unauthed shell
 * (effectively `null` for protected pages) and let the stream finish in a
 * single tick. Earlier versions handed out never-resolving promises on the
 * server to "stream the fallback forever"; that actually keeps the SSR
 * stream open until Nitro's 60s watchdog force-closes it with an
 * ECONNRESET, which is what users saw as a blank dark page after OAuth
 * sign-in. The client still suspends on first mount, then hydrates into
 * the real content once better-auth's session atom resolves.
 */

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
  provider: null,
}

let sessionInitialPromise: Promise<void> | null = null
let configPromiseCache: Promise<PublicAuthConfig> | null = null

/**
 * Resolves once the auth client's session atom has settled its first
 * `/get-session` fetch (regardless of whether the user is signed in).
 * Subsequent reactive updates — sign-in/out, cross-tab broadcast, refresh
 * — don't invalidate this; `useSession()` handles those live.
 */
function sessionInitializedPromise(): Promise<void> {
  if (sessionInitialPromise) return sessionInitialPromise

  if (typeof window === "undefined") {
    // SSR: resolve immediately so the stream can finish. `useSession()`
    // then returns the atom's initial `{ data: null, isPending: true }` on
    // the server, `useSuspenseSession` hands back `null`, and protected
    // surfaces render their signed-out branch (which on `/` is just
    // `null`). The client bundle loads from fresh module state so this
    // pre-resolved value never leaks into the browser — hydration builds
    // a real listener promise in the branch below.
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

/**
 * Public setup/auth-config probe. Cached for the lifetime of the page so
 * navigating between protected routes doesn't refetch it. Invalidated when
 * `$sessionSignal` fires (sign-up flips `setupRequired`; settings toggles
 * flip `emailPasswordEnabled` etc.).
 */
function configPromise(): Promise<PublicAuthConfig> {
  if (typeof window === "undefined") {
    // Same reasoning as `sessionInitializedPromise` above: don't hang the
    // SSR stream waiting for a browser-side fetch. The fallback shape
    // treats the instance as "no provider, not in setup" — good enough
    // for server-rendered chrome; the client re-fetches on hydration.
    return Promise.resolve(FALLBACK_CONFIG)
  }
  if (!configPromiseCache) {
    configPromiseCache = fetchAuthConfig().catch(() => FALLBACK_CONFIG)
  }
  return configPromiseCache
}

if (typeof window !== "undefined") {
  // Sign-in/out or profile updates can flip `setupRequired` (first admin)
  // and flag values exposed through `/auth-config`, so drop the cache and
  // let the next consumer refetch.
  authClient.$store.listen("$sessionSignal", () => {
    configPromiseCache = null
  })
}

/**
 * Suspends until the session atom has settled its first fetch, then
 * returns the current session reactively. Re-renders on sign-in/out
 * without re-suspending.
 */
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
