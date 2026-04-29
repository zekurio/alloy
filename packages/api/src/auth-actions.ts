import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser"
import type { AdminUserStorageRow } from "@workspace/contracts"

import {
  errorFrom,
  type AuthResult,
  type AuthUser,
  type LinkedAccount,
  type Passkey,
  type RequestFn,
  type SessionData,
  type SessionStore,
} from "./auth"

async function jsonResult<T>(
  request: RequestFn,
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

async function passkeySignIn(
  request: RequestFn,
  store: SessionStore
): AuthResult<SessionData> {
  try {
    const start = await request<{
      challengeId: string
      options: PublicKeyCredentialRequestOptionsJSON
    }>("/api/auth/passkey/sign-in/options", { method: "POST" })
    const response = await startAuthentication({
      optionsJSON: start.options,
    })
    const data = await request<SessionData>(
      "/api/auth/passkey/sign-in/verify",
      {
        method: "POST",
        body: JSON.stringify({ challengeId: start.challengeId, response }),
      }
    )
    store.set(data)
    return { data, error: null }
  } catch (cause) {
    return { data: null, error: errorFrom(cause, "Passkey sign-in failed") }
  }
}

async function passkeySignUp(
  request: RequestFn,
  store: SessionStore,
  input: { email: string; username: string }
): AuthResult<SessionData> {
  try {
    const data = await completeRegistrationChallenge<SessionData>(request, {
      optionsPath: "/api/auth/passkey/sign-up/options",
      verifyPath: "/api/auth/passkey/sign-up/verify",
      method: "POST",
      body: input,
    })
    store.set(data)
    return { data, error: null }
  } catch (cause) {
    return { data: null, error: errorFrom(cause, "Passkey sign-up failed") }
  }
}

async function addPasskey(
  request: RequestFn,
  input: { name?: string | null }
): AuthResult<Passkey> {
  try {
    const data = await completeRegistrationChallenge<Passkey>(request, {
      optionsPath: "/api/auth/passkeys/options",
      verifyPath: "/api/auth/passkeys/verify",
      method: "POST",
      extraVerifyBody: { name: input.name },
    })
    return { data, error: null }
  } catch (cause) {
    return { data: null, error: errorFrom(cause, "Could not add passkey") }
  }
}

async function completeRegistrationChallenge<T>(
  request: RequestFn,
  {
    optionsPath,
    verifyPath,
    method,
    body,
    extraVerifyBody,
  }: {
    optionsPath: string
    verifyPath: string
    method: "POST"
    body?: unknown
    extraVerifyBody?: Record<string, unknown>
  }
): Promise<T> {
  const start = await request<{
    challengeId: string
    options: PublicKeyCredentialCreationOptionsJSON
  }>(optionsPath, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const response: RegistrationResponseJSON = await startRegistration({
    optionsJSON: start.options,
  })
  return request<T>(verifyPath, {
    method: "POST",
    body: JSON.stringify({
      challengeId: start.challengeId,
      response,
      ...extraVerifyBody,
    }),
  })
}

function createPasskeyActions(request: RequestFn, store: SessionStore) {
  const result = <T>(path: string, init: RequestInit, fallback: string) =>
    jsonResult<T>(request, path, init, fallback)
  const signUpWithPasskey = (input: { email: string; username: string }) =>
    passkeySignUp(request, store, input)

  return {
    signIn: {
      passkey: () => passkeySignIn(request, store),
      oauth2: (input: { providerId: string; callbackURL?: string }) =>
        startOAuthRedirect(
          request,
          "/api/auth/oauth/sign-in",
          input,
          "Could not start OAuth sign-in"
        ),
    },
    signUp: {
      passkey: signUpWithPasskey,
    },
    passkey: {
      signUp: signUpWithPasskey,
      addPasskey: (input: { name?: string | null }) =>
        addPasskey(request, input),
      listUserPasskeys: () =>
        result<Passkey[]>("/api/auth/passkeys", {}, "Could not load passkeys"),
      updatePasskey: (input: { id: string; name?: string | null }) =>
        result<Passkey>(
          `/api/auth/passkeys/${encodeURIComponent(input.id)}`,
          { method: "PATCH", body: JSON.stringify({ name: input.name }) },
          "Could not update passkey"
        ),
      deletePasskey: (input: { id: string }) =>
        result<{ success: true }>(
          `/api/auth/passkeys/${encodeURIComponent(input.id)}`,
          { method: "DELETE" },
          "Could not delete passkey"
        ),
    },
  }
}

function createUserActions(request: RequestFn, store: SessionStore) {
  const result = <T>(path: string, init: RequestInit, fallback: string) =>
    jsonResult<T>(request, path, init, fallback)

  return {
    updateUser: async (input: { name?: string; username?: string }) => {
      const update = await result<{ user: AuthUser }>(
        "/api/auth/user",
        { method: "PATCH", body: JSON.stringify(input) },
        "Could not update user"
      )
      if (!update.error) await store.refetch()
      return update
    },
    deleteUser: () =>
      result<{ success: true }>(
        "/api/auth/user",
        { method: "DELETE" },
        "Could not delete user"
      ).then((deleteResult) => {
        if (!deleteResult.error) store.set(null)
        return deleteResult
      }),
    listAccounts: () =>
      result<LinkedAccount[]>(
        "/api/auth/accounts",
        {},
        "Could not load accounts"
      ),
    unlinkAccount: (input: { providerId: string; accountId: string }) =>
      result<{ success: true }>(
        "/api/auth/accounts/unlink",
        { method: "POST", body: JSON.stringify(input) },
        "Could not unlink account"
      ),
  }
}

async function startOAuthRedirect(
  request: RequestFn,
  path: string,
  input: { providerId: string; callbackURL?: string },
  fallback: string
): AuthResult<never> {
  try {
    const data = await request<{ url: string }>(path, {
      method: "POST",
      body: JSON.stringify(input),
    })
    window.location.assign(data.url)
    return { data: null, error: null }
  } catch (cause) {
    return { data: null, error: errorFrom(cause, fallback) }
  }
}

function createOAuthActions(request: RequestFn) {
  return {
    oauth2: {
      link: (input: { providerId: string; callbackURL?: string }) =>
        startOAuthRedirect(
          request,
          "/api/auth/oauth/link",
          input,
          "Could not start OAuth link"
        ),
    },
  }
}

function createAdminActions(request: RequestFn) {
  const result = <T>(path: string, init: RequestInit, fallback: string) =>
    jsonResult<T>(request, path, init, fallback)

  return {
    admin: {
      createUser: (input: {
        email: string
        name?: string
        username?: string
        role?: "user" | "admin"
      }) =>
        result<AdminUserStorageRow>(
          "/api/admin/users",
          { method: "POST", body: JSON.stringify(input) },
          "Could not create user"
        ),
      removeUser: (input: { userId: string }) =>
        result<{ success: true }>(
          `/api/admin/users/${encodeURIComponent(input.userId)}`,
          { method: "DELETE" },
          "Could not remove user"
        ),
      setRole: (input: { userId: string; role: "user" | "admin" }) =>
        result<AdminUserStorageRow>(
          `/api/admin/users/${encodeURIComponent(input.userId)}/role`,
          { method: "PATCH", body: JSON.stringify({ role: input.role }) },
          "Could not update role"
        ),
    },
  }
}

export function createAuthActions(request: RequestFn, store: SessionStore) {
  return {
    ...createPasskeyActions(request, store),
    ...createUserActions(request, store),
    ...createOAuthActions(request),
    ...createAdminActions(request),
  }
}
