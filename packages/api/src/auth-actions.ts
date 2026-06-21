import type { RegistrationResponseJSON } from "@simplewebauthn/browser"

import type {
  AuthRedirect,
  AuthResult,
  LinkedAccount,
  Passkey,
  RequestFn,
  SessionData,
  SessionStore,
} from "./auth"
import { AUTH_PATHS } from "./auth-paths"
import {
  type JsonValidator,
  validateLinkedAccounts,
  validateOAuthStartResponse,
  validatePasskey,
  validatePasskeyAuthenticationOptionsResponse,
  validatePasskeyRegistrationOptionsResponse,
  validatePasskeys,
  validateSessionData,
  validateSuccessResponse,
  validateUserUpdateResponse,
} from "./auth-validators"
import { errorFrom } from "./error"

type WebAuthnBrowser = typeof import("@simplewebauthn/browser")

let webAuthnBrowserPromise: Promise<WebAuthnBrowser> | null = null

function loadWebAuthnBrowser(): Promise<WebAuthnBrowser> {
  if (!webAuthnBrowserPromise) {
    const promise = import("@simplewebauthn/browser")
    webAuthnBrowserPromise = promise
    void promise.catch(() => {
      if (webAuthnBrowserPromise === promise) webAuthnBrowserPromise = null
    })
  }
  return webAuthnBrowserPromise
}

function preloadWebAuthnBrowser(): void {
  void loadWebAuthnBrowser()
}

async function jsonResult<T>(
  request: RequestFn,
  path: string,
  init: RequestInit,
  fallback: string,
  validate: JsonValidator<T>,
): AuthResult<T> {
  try {
    return { data: await request(path, init, validate), error: null }
  } catch (cause) {
    return { data: null, error: errorFrom(cause, fallback) }
  }
}

async function passkeySignIn(
  request: RequestFn,
  store: SessionStore,
): AuthResult<SessionData> {
  try {
    const [start, { startAuthentication }] = await Promise.all([
      request(
        AUTH_PATHS.passkeySignInOptions,
        { method: "POST" },
        validatePasskeyAuthenticationOptionsResponse,
      ),
      loadWebAuthnBrowser(),
    ])
    const response = await startAuthentication({
      optionsJSON: start.options,
    })
    const data = await request(
      AUTH_PATHS.passkeySignInVerify,
      {
        method: "POST",
        body: JSON.stringify({ challengeId: start.challengeId, response }),
      },
      validateSessionData,
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
  input: { email: string; username: string },
): AuthResult<SessionData> {
  try {
    const data = await completeRegistrationChallenge<SessionData>(request, {
      optionsPath: AUTH_PATHS.passkeySignUpOptions,
      verifyPath: AUTH_PATHS.passkeySignUpVerify,
      method: "POST",
      body: input,
      validateResult: validateSessionData,
    })
    store.set(data)
    return { data, error: null }
  } catch (cause) {
    return { data: null, error: errorFrom(cause, "Passkey sign-up failed") }
  }
}

async function addPasskey(
  request: RequestFn,
  input: { name?: string | null },
): AuthResult<Passkey> {
  try {
    const data = await completeRegistrationChallenge<Passkey>(request, {
      optionsPath: AUTH_PATHS.passkeyOptions,
      verifyPath: AUTH_PATHS.passkeyVerify,
      method: "POST",
      extraVerifyBody: { name: input.name },
      validateResult: validatePasskey,
    })
    return { data, error: null }
  } catch (cause) {
    return { data: null, error: errorFrom(cause, "Could not add passkey") }
  }
}

async function completeRegistrationChallenge<T>(
  request: RequestFn,
  options: {
    optionsPath: string
    verifyPath: string
    method: "POST"
    body?: unknown
    extraVerifyBody?: Record<string, unknown>
    validateResult: JsonValidator<T>
  },
): Promise<T> {
  const [start, { startRegistration }] = await Promise.all([
    request(
      options.optionsPath,
      {
        method: options.method,
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      },
      validatePasskeyRegistrationOptionsResponse,
    ),
    loadWebAuthnBrowser(),
  ])
  const response: RegistrationResponseJSON = await startRegistration({
    optionsJSON: start.options,
  })
  return request(
    options.verifyPath,
    {
      method: "POST",
      body: JSON.stringify({
        challengeId: start.challengeId,
        response,
        ...options.extraVerifyBody,
      }),
    },
    options.validateResult,
  )
}

function createPasskeyActions(
  request: RequestFn,
  store: SessionStore,
  redirect: AuthRedirect,
) {
  const result = <T>(
    path: string,
    init: RequestInit,
    fallback: string,
    validate: JsonValidator<T>,
  ) => jsonResult<T>(request, path, init, fallback, validate)
  const signUpWithPasskey = (input: { email: string; username: string }) =>
    passkeySignUp(request, store, input)

  return {
    signIn: {
      passkey: () => passkeySignIn(request, store),
      preloadPasskey: preloadWebAuthnBrowser,
      oauth2: (input: { providerId: string; callbackURL?: string }) =>
        startOAuthRedirect(
          request,
          redirect,
          AUTH_PATHS.oauthSignIn,
          input,
          "Could not start OAuth sign-in",
        ),
    },
    signUp: {
      passkey: signUpWithPasskey,
    },
    passkey: {
      preload: preloadWebAuthnBrowser,
      signUp: signUpWithPasskey,
      addPasskey: (input: { name?: string | null }) =>
        addPasskey(request, input),
      listUserPasskeys: () =>
        result(
          AUTH_PATHS.passkeys,
          {},
          "Could not load passkeys",
          validatePasskeys,
        ),
      updatePasskey: (input: { id: string; name?: string | null }) =>
        result(
          AUTH_PATHS.passkey(input.id),
          { method: "PATCH", body: JSON.stringify({ name: input.name }) },
          "Could not update passkey",
          validatePasskey,
        ),
      deletePasskey: (input: { id: string }) =>
        result(
          AUTH_PATHS.passkey(input.id),
          { method: "DELETE" },
          "Could not delete passkey",
          validateSuccessResponse,
        ),
    },
  }
}

function createUserActions(request: RequestFn, store: SessionStore) {
  const result = <T>(
    path: string,
    init: RequestInit,
    fallback: string,
    validate: JsonValidator<T>,
  ) => jsonResult<T>(request, path, init, fallback, validate)

  return {
    updateUser: async (input: {
      email?: string
      name?: string
      username?: string
    }) => {
      const update = await result(
        AUTH_PATHS.user,
        { method: "PATCH", body: JSON.stringify(input) },
        "Could not update user",
        validateUserUpdateResponse,
      )
      if (!update.error) await store.refetch()
      return update
    },
    deleteUser: () =>
      result(
        AUTH_PATHS.user,
        { method: "DELETE" },
        "Could not delete user",
        validateSuccessResponse,
      ).then((deleteResult) => {
        if (!deleteResult.error) store.set(null)
        return deleteResult
      }),
    listAccounts: () =>
      result<LinkedAccount[]>(
        AUTH_PATHS.accounts,
        {},
        "Could not load accounts",
        validateLinkedAccounts,
      ),
    unlinkAccount: (input: { providerId: string; accountId: string }) =>
      result(
        AUTH_PATHS.accountsUnlink,
        { method: "POST", body: JSON.stringify(input) },
        "Could not unlink account",
        validateSuccessResponse,
      ),
  }
}

async function startOAuthRedirect(
  request: RequestFn,
  redirect: AuthRedirect,
  path: string,
  input: { providerId: string; callbackURL?: string },
  fallback: string,
): AuthResult<never> {
  try {
    const data = await request(
      path,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      validateOAuthStartResponse,
    )
    redirect(data.url)
    return { data: null, error: null }
  } catch (cause) {
    return { data: null, error: errorFrom(cause, fallback) }
  }
}

function createOAuthActions(request: RequestFn, redirect: AuthRedirect) {
  return {
    oauth2: {
      link: (input: { providerId: string; callbackURL?: string }) =>
        startOAuthRedirect(
          request,
          redirect,
          AUTH_PATHS.oauthLink,
          input,
          "Could not start OAuth link",
        ),
    },
  }
}

export function createAuthActions(
  request: RequestFn,
  store: SessionStore,
  redirect: AuthRedirect,
) {
  return {
    ...createPasskeyActions(request, store, redirect),
    ...createUserActions(request, store),
    ...createOAuthActions(request, redirect),
  }
}
