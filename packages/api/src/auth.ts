import * as React from "react"
import { createAuthActions } from "./auth-actions"

type AuthError = { message: string }
type AuthResult<T> = Promise<{ data: T | null; error: AuthError | null }>

export type AuthUser = {
  id: string
  email: string
  emailVerified: boolean
  username: string
  displayUsername: string
  name: string
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
  createdAt: string | Date
  deviceType?: string
}

export type LinkedAccount = {
  id: string
  providerId: string
  accountId: string
  createdAt: string | Date
}

type StoreState = {
  data: SessionData | null
  isPending: boolean
  error: Error | null
}

type SessionStore = ReturnType<typeof createSessionStore>
type RequestFn = <T>(path: string, init?: RequestInit) => Promise<T>

export type { AuthError, AuthResult, RequestFn, SessionStore }

export function errorFrom(cause: unknown, fallback: string): AuthError {
  return {
    message: cause instanceof Error ? cause.message : fallback,
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string; message?: string }
    | T
    | null
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? (body.error ?? `${res.status} ${res.statusText}`)
        : `${res.status} ${res.statusText}`
    throw new Error(message)
  }
  return body as T
}

function createSessionStore(fetchSession: () => Promise<SessionData | null>) {
  let state: StoreState = { data: null, isPending: true, error: null }
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) listener()
  }

  async function refetch(_options?: unknown): Promise<{ data: SessionData | null }> {
    state = { ...state, isPending: true, error: null }
    emit()
    try {
      const data = await fetchSession()
      state = { data, isPending: false, error: null }
      emit()
      return { data }
    } catch (cause) {
      const error =
        cause instanceof Error ? cause : new Error("Could not load session")
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

export type AuthClient = ReturnType<typeof createAuth>

export function createAuth(baseURL: string) {
  function url(path: string): string {
    return new URL(path, baseURL).toString()
  }

  async function request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(url(path), {
      credentials: "include",
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    })
    return readJson<T>(res)
  }

  async function fetchSession(): Promise<SessionData | null> {
    return request<SessionData | null>("/api/auth/session")
  }

  const store = createSessionStore(fetchSession)

  function useSession() {
    const snapshot = React.useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot
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
      const data = await request<{ success: true }>("/api/auth/sign-out", {
        method: "POST",
      })
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
    ...createAuthActions(request, store),
  }
}
