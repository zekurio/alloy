import type {
  AuthErrorCode,
  ContractJsonInput,
  SessionData,
} from "@alloy/contracts"
import { useSyncExternalStore } from "react"

import { createAuthActions } from "./auth-actions"
import { AUTH_PATHS } from "./auth-paths"
import {
  type JsonValidator,
  validateSessionDataOrNull,
  validateSuccessResponse,
} from "./auth-validators"
import { createApiClient } from "./client"
import { errorFrom, toError } from "./error"
import { readJsonOrThrow } from "./http"

export {
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@alloy/contracts"

type AuthError = { message: string; code?: AuthErrorCode }
type AuthResult<T> = Promise<{ data: T | null; error: AuthError | null }>
type AuthRedirect = (url: string) => void

export interface CreateAuthOptions {
  baseURL: string
  redirect?: AuthRedirect
}

export type {
  AuthSessionSummary,
  AuthUser,
  LinkedAccount,
  Passkey,
  SessionData,
} from "@alloy/contracts"

type StoreState = {
  data: SessionData | null
  isPending: boolean
  error: Error | null
}

type SessionStore = ReturnType<typeof createSessionStore>
type RequestFn = <T>(
  path: string,
  init: RequestInit,
  validate: JsonValidator<T>,
) => Promise<T>

export type { AuthError, AuthResult, RequestFn, SessionStore }
export type { AuthRedirect }

type SessionResult = { data: SessionData | null }

function createSessionStore(fetchSession: () => Promise<SessionData | null>) {
  let state: StoreState = { data: null, isPending: true, error: null }
  // Every refetch and set() takes the next generation. Only the newest one
  // writes state, so a slow refetch cannot overwrite a later sign-in.
  let generation = 0
  let latestRefetch: Promise<SessionResult> | null = null
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) listener()
  }

  /** What an overtaken refetch resolves to: the newer refetch, or set()'s data. */
  function newerResult(): Promise<SessionResult> {
    return latestRefetch ?? Promise.resolve({ data: state.data })
  }

  async function load(startedAt: number): Promise<SessionResult> {
    let data: SessionData | null
    try {
      data = await fetchSession()
    } catch (cause) {
      if (startedAt !== generation) return newerResult()
      latestRefetch = null
      const error = toError(cause, "Could not load session")
      state = { ...state, isPending: false, error }
      emit()
      throw error
    }
    if (startedAt !== generation) return newerResult()
    latestRefetch = null
    state = { data, isPending: false, error: null }
    emit()
    return { data }
  }

  // Callers may still pass better-auth's refetch options; they are ignored.
  function refetch(_options?: ContractJsonInput): Promise<SessionResult> {
    generation += 1
    const request = load(generation)
    latestRefetch = request
    state = { ...state, isPending: true, error: null }
    emit()
    return request
  }

  const initial = refetch().catch(() => ({ data: null }))

  return {
    initial,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(data: SessionData | null) {
      generation += 1
      latestRefetch = null
      state = { data, isPending: false, error: null }
      emit()
    },
    refetch,
  }
}

function defaultAuthRedirect(url: string): void {
  if (!("window" in globalThis)) {
    throw new Error("OAuth redirects require a browser redirect handler")
  }
  window.location.assign(url)
}

export function createAuth(options: CreateAuthOptions) {
  const redirect = options.redirect ?? defaultAuthRedirect
  const client = createApiClient(options.baseURL)

  async function request<T>(
    path: string,
    init: RequestInit,
    validate: JsonValidator<T>,
  ): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
    const res = await client.request(path, {
      init: { ...init, headers },
    })
    return readJsonOrThrow(res, validate)
  }

  async function fetchSession(): Promise<SessionData | null> {
    return request(AUTH_PATHS.session, {}, validateSessionDataOrNull)
  }

  const store = createSessionStore(fetchSession)

  function useSession() {
    const snapshot = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    )
    return { ...snapshot, refetch: store.refetch }
  }

  async function getSession(): AuthResult<SessionData | null> {
    try {
      return { data: (await store.refetch()).data, error: null }
    } catch (cause) {
      return { data: null, error: errorFrom(cause, "Could not load session") }
    }
  }

  async function signOut(): AuthResult<{ success: true }> {
    try {
      const data = await request(
        AUTH_PATHS.signOut,
        { method: "POST" },
        validateSuccessResponse,
      )
      store.set(null)
      return { data, error: null }
    } catch (cause) {
      return { data: null, error: errorFrom(cause, "Could not sign out") }
    }
  }

  return {
    getSession,
    signOut,
    useSession,
    $store: {
      initial: store.initial,
      getSnapshot: store.getSnapshot,
      subscribe: store.subscribe,
      refetch: store.refetch,
    },
    ...createAuthActions(request, store, redirect),
  }
}
