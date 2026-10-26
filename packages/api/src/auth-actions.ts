import type {
  AuthSessionSummary,
  ContractJsonValue,
  LinkedAccount,
  OAuthSignInAccount,
  Passkey,
  SessionData,
  SyncedThemePreferences,
  UserThemeInput,
} from "@alloy/contracts"
import type { RegistrationResponseJSON } from "@simplewebauthn/browser"

import type { AuthRedirect, AuthResult, RequestFn, SessionStore } from "./auth"
import { AUTH_PATHS } from "./auth-paths"
import {
  type JsonValidator,
  validateAuthSessionSummaries,
  validateLinkedAccounts,
  validatePasskey,
  validatePasskeyAuthenticationOptionsResponse,
  validatePasskeyRegistrationOptionsResponse,
  validatePasskeys,
  validatePendingOAuthLinkOrNull,
  validateRedirectResponse,
  validateRevokeOtherSessionsResponse,
  validateSessionData,
  validateSuccessResponse,
  validateUserThemeListResponse,
  validateUserThemeResponse,
  validateUserUpdateResponse,
} from "./auth-validators"
import { errorFrom } from "./error"
type WebAuthnBrowser = typeof import("@simplewebauthn/browser")

function loadWebAuthnBrowser(): Promise<WebAuthnBrowser> {
  return import("@simplewebauthn/browser")
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

async function completeAccountReactivation(
  request: RequestFn,
  store: SessionStore,
): AuthResult<SessionData> {
  try {
    const data = await request(
      AUTH_PATHS.reactivate,
      { method: "POST" },
      validateSessionData,
    )
    store.set(data)
    return { data, error: null }
  } catch (cause) {
    return {
      data: null,
      error: errorFrom(cause, "Account reactivation failed"),
    }
  }
}

async function passkeySignUp(
  request: RequestFn,
  store: SessionStore,
  input: { username: string },
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
    extraVerifyBody?: Record<string, ContractJsonValue>
    validateResult: JsonValidator<T>
  },
): Promise<T> {
  const init: RequestInit = { method: options.method }
  if (options.body !== undefined) init.body = JSON.stringify(options.body)
  const [start, { startRegistration }] = await Promise.all([
    request(
      options.optionsPath,
      init,
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
  const signUpWithPasskey = (input: { username: string }) =>
    passkeySignUp(request, store, input)

  return {
    signIn: {
      passkey: () => passkeySignIn(request, store),
      reactivate: () => completeAccountReactivation(request, store),
      preloadPasskey: preloadWebAuthnBrowser,
      oauth2: (input: {
        providerId: string
        callbackURL?: string
        account?: OAuthSignInAccount
      }) =>
        redirectResult(
          request,
          redirect,
          AUTH_PATHS.oauthSignIn,
          { method: "POST", body: JSON.stringify(input) },
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
      name?: string
      username?: string
      displayName?: string
      clipAnnouncementsEnabled?: boolean
    }) => {
      const update = await result(
        AUTH_PATHS.user,
        { method: "PATCH", body: JSON.stringify(input) },
        "Could not update user",
        validateUserUpdateResponse,
      )
      // The response carries the saved user, so apply it to the session
      // directly. Refetching here could fail after the write landed and
      // reject a save that succeeded.
      const current = store.getSnapshot().data
      if (update.data && current)
        store.set({ ...current, user: update.data.user })
      return update
    },
    /** Saves the theme the user's devices share, like {@link updateUser}. */
    updateThemePreferences: async (preferences: SyncedThemePreferences) => {
      const update = await result(
        AUTH_PATHS.userTheme,
        { method: "PUT", body: JSON.stringify(preferences) },
        "Could not save theme",
        validateUserUpdateResponse,
      )
      const current = store.getSnapshot().data
      if (update.data && current)
        store.set({ ...current, user: update.data.user })
      return update
    },
    listThemes: () =>
      result(
        AUTH_PATHS.userThemes,
        {},
        "Could not load themes",
        validateUserThemeListResponse,
      ),
    /** Creates or replaces the theme; the id comes from the client. */
    saveTheme: (id: string, theme: UserThemeInput) =>
      result(
        AUTH_PATHS.userThemeById(id),
        { method: "PUT", body: JSON.stringify(theme) },
        "Could not save theme",
        validateUserThemeResponse,
      ),
    deleteTheme: (id: string) =>
      result(
        AUTH_PATHS.userThemeById(id),
        { method: "DELETE" },
        "Could not delete theme",
        validateSuccessResponse,
      ),
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
    listSessions: () =>
      result<AuthSessionSummary[]>(
        AUTH_PATHS.sessions,
        {},
        "Could not load sessions",
        validateAuthSessionSummaries,
      ),
    revokeSession: (input: { id: string }) =>
      result(
        AUTH_PATHS.sessionById(input.id),
        { method: "DELETE" },
        "Could not sign out session",
        validateSuccessResponse,
      ),
    revokeOtherSessions: () =>
      result(
        AUTH_PATHS.sessionsRevokeOthers,
        { method: "POST" },
        "Could not sign out other sessions",
        validateRevokeOtherSessionsResponse,
      ),
  }
}

/** Send a request that answers with a URL, then go there. */
async function redirectResult(
  request: RequestFn,
  redirect: AuthRedirect,
  path: string,
  init: RequestInit,
  fallback: string,
): AuthResult<never> {
  try {
    const data = await request(path, init, validateRedirectResponse)
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
        redirectResult(
          request,
          redirect,
          AUTH_PATHS.oauthLink,
          { method: "POST", body: JSON.stringify(input) },
          "Could not start OAuth link",
        ),
      /**
       * An OAuth sign-in in this browser whose username claim matched an
       * existing user. Linking it or creating an account from it goes back to
       * where that sign-in started, without another trip to the provider.
       */
      pending: {
        get: () =>
          jsonResult(
            request,
            AUTH_PATHS.oauthPending,
            {},
            "Could not load pending sign-in",
            validatePendingOAuthLinkOrNull,
          ),
        /** Link it to the signed-in user. */
        link: () =>
          redirectResult(
            request,
            redirect,
            AUTH_PATHS.oauthPendingLink,
            { method: "POST" },
            "Could not link OAuth account.",
          ),
        /** Create a new account for it instead, and sign in. */
        signUp: () =>
          redirectResult(
            request,
            redirect,
            AUTH_PATHS.oauthPendingSignUp,
            { method: "POST" },
            "OAuth sign-in failed",
          ),
        discard: () =>
          jsonResult(
            request,
            AUTH_PATHS.oauthPending,
            { method: "DELETE" },
            "Could not discard pending sign-in",
            validateSuccessResponse,
          ),
      },
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
