import * as React from "react"

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

export { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@alloy/contracts"

type AuthError = { message: string }
type AuthResult<T> = Promise<{ data: T | null; error: AuthError | null }>
type AuthRedirect = (url: string) => void

export interface CreateAuthOptions {
  baseURL: string
  redirect?: AuthRedirect
}

export type AuthUser = {
  id: string
  email: string
  emailVerified: boolean
  username: string
  displayUsername: string
  image: string | null
  banner: string | null
  role: "user" | "admin"
  status: "active" | "disabled"
  disabledAt: string | null
  storageQuotaBytes: number | null
  createdAt: string
  updatedAt: string
}

export type SessionData = {
  session: {
    id: string
    userId: string
    expiresAt: string | null
    createdAt: string
    updatedAt: string
    lastSeenAt: string | null
  }
  user: AuthUser
}

export type Passkey = {
  id: string
  name: string | null
  createdAt: string
  deviceType: string
}

export type LinkedAccount = {
  id: string
  providerId: string
  accountId: string
  email: string | null
  createdAt: string
}

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

function createSessionStore(fetchSession: () => Promise<SessionData | null>) {
  let state: StoreState = { data: null, isPending: true, error: null }
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) listener()
  }

  async function refetch(
    _options?: unknown,
  ): Promise<{ data: SessionData | null }> {
    state = { ...state, isPending: true, error: null }
    emit()
    try {
      const data = await fetchSession()
      state = { data, isPending: false, error: null }
      emit()
      return { data }
    } catch (cause) {
      const error = toError(cause, "Could not load session")
      state = { ...state, isPending: false, error }
      emit()
      throw error
    }
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
      state = { data, isPending: false, error: null }
      emit()
    },
    refetch,
  }
}

function defaultAuthRedirect(url: string): void {
  if (typeof window === "undefined") {
    throw new Error("OAuth redirects require a browser redirect handler")
  }
  window.location.assign(url)
}

export function createAuth(input: string | CreateAuthOptions) {
  const baseURL = typeof input === "string" ? input : input.baseURL
  const redirect =
    typeof input === "string"
      ? defaultAuthRedirect
      : (input.redirect ?? defaultAuthRedirect)
  const client = createApiClient(baseURL)

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
    const snapshot = React.useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    )
    return { ...snapshot, refetch: store.refetch }
  }

  async function getSession(): AuthResult<SessionData | null> {
    try {
      const { data } = await store.refetch()
      return { data, error: null }
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
