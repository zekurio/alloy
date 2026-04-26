import * as React from "react"
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser"
import type { AdminUserStorageRow } from "@workspace/contracts"

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

function errorFrom(cause: unknown, fallback: string): AuthError {
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

  async function passkeySignIn(): AuthResult<SessionData> {
    try {
      const start = await request<{
        challengeId: string
        options: PublicKeyCredentialRequestOptionsJSON
      }>("/api/auth/passkey/sign-in/options", { method: "POST" })
      const response = await startAuthentication({
        optionsJSON: start.options,
      })
      const data = await request<SessionData>("/api/auth/passkey/sign-in/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId: start.challengeId, response }),
      })
      store.set(data)
      return { data, error: null }
    } catch (cause) {
      return { data: null, error: errorFrom(cause, "Passkey sign-in failed") }
    }
  }

  async function passkeySignUp(input: {
    email: string
    username: string
  }): AuthResult<SessionData> {
    try {
      const start = await request<{
        challengeId: string
        options: PublicKeyCredentialCreationOptionsJSON
      }>("/api/auth/passkey/sign-up/options", {
        method: "POST",
        body: JSON.stringify(input),
      })
      const response = await startRegistration({
        optionsJSON: start.options,
      })
      const data = await request<SessionData>("/api/auth/passkey/sign-up/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId: start.challengeId, response }),
      })
      store.set(data)
      return { data, error: null }
    } catch (cause) {
      return { data: null, error: errorFrom(cause, "Passkey sign-up failed") }
    }
  }

  async function addPasskey(input: {
    name?: string | null
  }): AuthResult<Passkey> {
    try {
      const start = await request<{
        challengeId: string
        options: PublicKeyCredentialCreationOptionsJSON
      }>("/api/auth/passkeys/options", { method: "POST" })
      const response: RegistrationResponseJSON = await startRegistration({
        optionsJSON: start.options,
      })
      const data = await request<Passkey>("/api/auth/passkeys/verify", {
        method: "POST",
        body: JSON.stringify({
          challengeId: start.challengeId,
          response,
          name: input.name,
        }),
      })
      return { data, error: null }
    } catch (cause) {
      return { data: null, error: errorFrom(cause, "Could not add passkey") }
    }
  }

  async function jsonResult<T>(
    path: string,
    init: RequestInit,
    fallback: string
  ): AuthResult<T> {
    try {
      return { data: await request<T>(path, init), error: null }
    } catch (cause) {
      return { data: null, error: errorFrom(cause, fallback) }
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
    signIn: {
      passkey: passkeySignIn,
      oauth2: async (_input?: unknown): AuthResult<never> => ({
        data: null,
        error: { message: "OAuth sign-in is not implemented yet." },
      }),
    },
    signUp: {
      passkey: passkeySignUp,
    },
    passkey: {
      signUp: passkeySignUp,
      addPasskey,
      listUserPasskeys: () =>
        jsonResult<Passkey[]>("/api/auth/passkeys", {}, "Could not load passkeys"),
      updatePasskey: (input: { id: string; name?: string | null }) =>
        jsonResult<Passkey>(
          `/api/auth/passkeys/${encodeURIComponent(input.id)}`,
          { method: "PATCH", body: JSON.stringify({ name: input.name }) },
          "Could not update passkey"
        ),
      deletePasskey: (input: { id: string }) =>
        jsonResult<{ success: true }>(
          `/api/auth/passkeys/${encodeURIComponent(input.id)}`,
          { method: "DELETE" },
          "Could not delete passkey"
        ),
    },
    updateUser: async (input: { name?: string; username?: string }) => {
      const result = await jsonResult<{ user: AuthUser }>(
        "/api/auth/user",
        { method: "PATCH", body: JSON.stringify(input) },
        "Could not update user"
      )
      if (!result.error) await store.refetch()
      return result
    },
    deleteUser: () =>
      jsonResult<{ success: true }>(
        "/api/auth/user",
        { method: "DELETE" },
        "Could not delete user"
      ).then((result) => {
        if (!result.error) store.set(null)
        return result
      }),
    listAccounts: () =>
      jsonResult<LinkedAccount[]>("/api/auth/accounts", {}, "Could not load accounts"),
    unlinkAccount: (input: { providerId: string; accountId: string }) =>
      jsonResult<{ success: true }>(
        "/api/auth/accounts/unlink",
        { method: "POST", body: JSON.stringify(input) },
        "Could not unlink account"
      ),
    oauth2: {
      link: async (_input?: unknown): AuthResult<never> => ({
        data: null,
        error: { message: "OAuth linking is not implemented yet." },
      }),
    },
    admin: {
      createUser: (input: {
        email: string
        name?: string
        username?: string
        role?: "user" | "admin"
      }) =>
        jsonResult<AdminUserStorageRow>(
          "/api/admin/users",
          { method: "POST", body: JSON.stringify(input) },
          "Could not create user"
        ),
      removeUser: (input: { userId: string }) =>
        jsonResult<{ success: true }>(
          `/api/admin/users/${encodeURIComponent(input.userId)}`,
          { method: "DELETE" },
          "Could not remove user"
        ),
      setRole: (input: { userId: string; role: "user" | "admin" }) =>
        jsonResult<AdminUserStorageRow>(
          `/api/admin/users/${encodeURIComponent(input.userId)}/role`,
          { method: "PATCH", body: JSON.stringify({ role: input.role }) },
          "Could not update role"
        ),
    },
  }
}
