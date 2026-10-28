import {
  OAUTH_SIGN_IN_ACCOUNTS,
  type OAuthSignInAccount,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { createLogger } from "@alloy/logging"
import type { Context } from "hono"
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  type JsonObject,
  randomPKCECodeVerifier,
  randomState,
} from "openid-client"

import { completeAuthenticatedSignIn } from "./account-sign-in"
import { insertAuthChallenge } from "./challenges"
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setOAuthPendingLinkCookie,
} from "./cookies"
import {
  createFirstAdminForOAuthAccount,
  linkAccountToUser,
  resolveSignInUser,
} from "./oauth-accounts"
import {
  browserNonceMatches,
  consumeOAuthChallenge,
  OAUTH_PURPOSE,
  OAUTH_STATE_TTL_MS,
} from "./oauth-challenges"
import {
  callbackURLForProvider,
  callbackURLWithOAuthError,
  callbackURLWithWelcome,
  loginURLWithAccountReactivation,
  loginURLWithOAuthError,
  loginURLWithOAuthLink,
  normalizeCallbackURL,
  oauthClient,
  oauthErrorLogDetail,
  requireEnabledProvider,
  scopesForProvider,
} from "./oauth-client"
import { savePendingOAuthLink } from "./oauth-pending-link"
import { profileFromTokens, storedTokens } from "./oauth-profile"
import type { OAuthChallengePayload, OAuthMode } from "./oauth-types"
import { getSession } from "./session"
import {
  endSetupAccess,
  hasSetupAccess,
  SETUP_ACCESS_REQUIRED,
} from "./setup-token"

const logger = createLogger("oauth")
const OAuthChallengePayloadSchema = t.object({
  account: t.enum(OAUTH_SIGN_IN_ACCOUNTS).optional(),
  browserNonce: t.string(),
  callbackURL: t.string(),
  codeVerifier: t.string().optional(),
  mode: t.enum(["sign-in", "link"]),
  providerId: t.string(),
  setupFirstAdmin: t.boolean().optional(),
  userId: t.string().optional(),
})

export { fallbackOAuthErrorRedirect } from "./oauth-client"

export async function startOAuthSignIn(input: {
  providerId: string
  callbackURL?: string | null
  account?: OAuthSignInAccount
  setupFirstAdmin?: boolean
}): Promise<{ browserNonce: string; url: string }> {
  return startOAuthFlow({ ...input, mode: "sign-in" })
}

export async function startOAuthLink(input: {
  providerId: string
  callbackURL?: string | null
  userId: string
}): Promise<{ browserNonce: string; url: string }> {
  return startOAuthFlow({ ...input, mode: "link" })
}

async function startOAuthFlow(input: {
  providerId: string
  callbackURL?: string | null
  account?: OAuthSignInAccount
  mode: OAuthMode
  setupFirstAdmin?: boolean
  userId?: string
}): Promise<{ browserNonce: string; url: string }> {
  const provider = requireEnabledProvider(input.providerId)

  const state = randomState()
  const browserNonce = randomState()
  const codeVerifier = provider.pkce ? randomPKCECodeVerifier() : undefined
  const callbackURL = normalizeCallbackURL(input.callbackURL)
  const config = await oauthClient(provider)
  const scope = scopesForProvider(provider)

  const params = new URLSearchParams({
    ...provider.authParams,
    redirect_uri: callbackURLForProvider(provider.providerId),
    scope,
    state,
  })
  if (codeVerifier) {
    params.set("code_challenge", await calculatePKCECodeChallenge(codeVerifier))
    params.set("code_challenge_method", "S256")
  }

  const url = buildAuthorizationUrl(config, params)
  const payload: OAuthChallengePayload = {
    account: input.account,
    browserNonce,
    callbackURL,
    codeVerifier,
    mode: input.mode,
    providerId: provider.providerId,
    setupFirstAdmin: input.setupFirstAdmin,
    userId: input.userId,
  }

  await insertAuthChallenge({
    purpose: OAUTH_PURPOSE,
    identifier: state,
    challenge: state,
    payload,
    userId: input.mode === "link" ? (input.userId ?? null) : null,
    ttlMs: OAUTH_STATE_TTL_MS,
  })

  return { browserNonce, url: url.toString() }
}

export async function finishOAuthCallback(
  c: Context,
  providerId: string,
): Promise<{ redirectTo: string }> {
  // Clear the single-use state cookie up front so no failure below leaves it,
  // including a provider that was disabled while the flow was in progress.
  const browserNonce = readOAuthStateCookie(c, providerId)
  clearOAuthStateCookie(c, providerId)
  const provider = requireEnabledProvider(providerId)
  const currentURL = new URL(c.req.url)
  const state = currentURL.searchParams.get("state")
  if (!state) throw new Error("Missing OAuth state.")

  const challenge = await consumeOAuthChallenge(state)
  const payload = requireOAuthChallengePayload(challenge.payload)
  try {
    if (payload.providerId !== provider.providerId) {
      throw new Error("OAuth provider changed during sign-in.")
    }
    if (!browserNonceMatches(browserNonce, payload.browserNonce)) {
      throw new Error("OAuth sign-in did not start in this browser.")
    }

    const callbackURL = new URL(callbackURLForProvider(provider.providerId))
    callbackURL.search = currentURL.search

    const config = await oauthClient(provider)
    const tokens = await authorizationCodeGrant(config, callbackURL, {
      expectedState: state,
      pkceCodeVerifier: payload.codeVerifier,
    })
    const profile = await profileFromTokens(config, provider, tokens)
    const stored = storedTokens(tokens)

    if (payload.mode === "link") {
      const session = await getSession(c)
      if (
        !session ||
        session.user.status !== "active" ||
        session.user.id !== payload.userId
      ) {
        throw new Error("Sign in again before linking this account.")
      }
      await linkAccountToUser({
        profile,
        provider,
        tokens: stored,
        userId: session.user.id,
      })
      logger.info(
        `linked ${provider.providerId} account to user ${session.user.id}`,
      )
      return { redirectTo: payload.callbackURL }
    }

    if (payload.setupFirstAdmin) {
      if (!hasSetupAccess(c)) throw new Error(SETUP_ACCESS_REQUIRED)
      const userId = await createFirstAdminForOAuthAccount({
        profile,
        provider,
        tokens: stored,
      })
      endSetupAccess(c)
      logger.info(`${provider.providerId} sign-in created admin ${userId}`)
      await completeAuthenticatedSignIn(c, userId)
      return { redirectTo: payload.callbackURL }
    }

    const resolved = await resolveSignInUser({
      profile,
      provider,
      tokens: stored,
      account: payload.account,
    })
    if (resolved.kind === "link-required") {
      logger.info(
        `${provider.providerId} sign-in matched the username of user ${resolved.userId}; asking to link`,
      )
      const pendingToken = await savePendingOAuthLink({
        callbackURL: payload.callbackURL,
        profile,
        providerId: provider.providerId,
        tokens: stored,
      })
      setOAuthPendingLinkCookie(c, pendingToken)
      return {
        redirectTo: loginURLWithOAuthLink(
          payload.callbackURL,
          provider.providerId,
        ),
      }
    }
    const { kind, userId } = resolved
    logger.info(`${provider.providerId} sign-in ${kind} user ${userId}`)
    const signIn = await completeAuthenticatedSignIn(c, userId)
    if (signIn.kind === "reactivation-required") {
      return {
        redirectTo: loginURLWithAccountReactivation(payload.callbackURL),
      }
    }
    if (signIn.kind === "banned") {
      return {
        redirectTo: loginURLWithOAuthError(
          payload.callbackURL,
          new Error("This account has been banned by an administrator."),
        ),
      }
    }
    return {
      redirectTo:
        kind === "created"
          ? callbackURLWithWelcome(payload.callbackURL, provider.providerId)
          : payload.callbackURL,
    }
  } catch (cause) {
    logger.warn(
      `${payload.mode} callback failed for ${provider.providerId}:`,
      oauthErrorLogDetail(cause),
    )
    // A failed link keeps the user signed in, so send them back to where they
    // started (settings). A sign-in from the link page goes back to it to try
    // another method. Other failed sign-ins leave them logged out, so route to
    // /login where the error toast can actually surface.
    // Setup keeps redirecting /login to /setup, so its errors go back there.
    return {
      redirectTo:
        payload.mode === "link" ||
        payload.account === "linked" ||
        payload.setupFirstAdmin
          ? callbackURLWithOAuthError(payload.callbackURL, cause)
          : loginURLWithOAuthError(payload.callbackURL, cause),
    }
  }
}

function requireOAuthChallengePayload(
  payload: JsonObject,
): OAuthChallengePayload {
  const parsed = OAuthChallengePayloadSchema.safeParse(payload)
  if (parsed.success) return parsed.data
  throw new Error("OAuth state payload is invalid.")
}
