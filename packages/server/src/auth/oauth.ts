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
import { clearOAuthStateCookie, readOAuthStateCookie } from "./cookies"
import { linkAccountToUser, resolveSignInUser } from "./oauth-accounts"
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
import { profileFromTokens, storedTokens } from "./oauth-profile"
import type { OAuthChallengePayload, OAuthMode } from "./oauth-types"
import { getSession } from "./session"

const logger = createLogger("oauth")
const OAuthChallengePayloadSchema = t.object({
  browserNonce: t.string(),
  callbackURL: t.string(),
  codeVerifier: t.string().optional(),
  createAccount: t.boolean().optional(),
  mode: t.enum(["sign-in", "link"]),
  providerId: t.string(),
  userId: t.string().optional(),
})

export { fallbackOAuthErrorRedirect } from "./oauth-client"

export async function startOAuthSignIn(input: {
  providerId: string
  callbackURL?: string | null
  createAccount?: boolean
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
  createAccount?: boolean
  mode: OAuthMode
  userId?: string
}): Promise<{ browserNonce: string; url: string }> {
  const provider = requireEnabledProvider(input.providerId)

  const state = randomState()
  const browserNonce = randomState()
  const codeVerifier =
    provider.pkce === false ? undefined : randomPKCECodeVerifier()
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
    browserNonce,
    callbackURL,
    codeVerifier,
    createAccount: input.createAccount,
    mode: input.mode,
    providerId: provider.providerId,
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
        tokens: storedTokens(tokens),
        userId: session.user.id,
      })
      logger.info(
        `linked ${provider.providerId} account to user ${session.user.id}`,
      )
      return { redirectTo: payload.callbackURL }
    }

    const resolved = await resolveSignInUser({
      profile,
      provider,
      tokens: storedTokens(tokens),
      createAccount: payload.createAccount === true,
    })
    if (resolved.kind === "link-required") {
      logger.info(
        `${provider.providerId} sign-in matched the username of user ${resolved.userId}; asking to link`,
      )
      return {
        redirectTo: loginURLWithOAuthLink(
          payload.callbackURL,
          provider.providerId,
          resolved.username,
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
    // started (settings). A failed sign-in leaves them logged out, so route to
    // /login where the error toast can actually surface.
    return {
      redirectTo:
        payload.mode === "link"
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
