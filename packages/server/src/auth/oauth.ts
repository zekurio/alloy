import { authChallenge } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { errorDetail } from "@alloy/server/runtime/error-message"
import type { Context } from "hono"
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  randomPKCECodeVerifier,
  randomState,
} from "openid-client"

import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setSessionCookies,
} from "./cookies"
import { linkAccountToUser, resolveSignInUser } from "./oauth-accounts"
import {
  consumeOAuthChallenge,
  deleteExpiredOAuthChallenges,
  OAUTH_PURPOSE,
  OAUTH_STATE_TTL_MS,
} from "./oauth-challenges"
import {
  callbackURLForProvider,
  callbackURLWithOAuthError,
  loginURLWithOAuthError,
  normalizeCallbackURL,
  oauthClient,
  requireEnabledProvider,
  scopesForProvider,
} from "./oauth-client"
import { profileFromTokens, storedTokens } from "./oauth-profile"
import type { OAuthChallengePayload, OAuthMode } from "./oauth-types"
import { createSession, getSession } from "./session"

const logger = createLogger("oauth")

export { fallbackOAuthErrorRedirect } from "./oauth-client"

export async function startOAuthSignIn(input: {
  providerId: string
  callbackURL?: string | null
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
  mode: OAuthMode
  userId?: string
}): Promise<{ browserNonce: string; url: string }> {
  const provider = requireEnabledProvider(input.providerId)
  await deleteExpiredOAuthChallenges()

  const state = randomState()
  const browserNonce = randomState()
  const codeVerifier =
    provider.pkce === false ? undefined : randomPKCECodeVerifier()
  const callbackURL = normalizeCallbackURL(input.callbackURL)
  const config = await oauthClient(provider)
  const scope = scopesForProvider(provider)

  const params: Record<string, string> = {
    redirect_uri: callbackURLForProvider(provider.providerId),
    scope,
    state,
  }
  if (codeVerifier) {
    params.code_challenge = await calculatePKCECodeChallenge(codeVerifier)
    params.code_challenge_method = "S256"
  }

  const url = buildAuthorizationUrl(config, params)
  const payload: OAuthChallengePayload = {
    browserNonce,
    callbackURL,
    codeVerifier,
    mode: input.mode,
    providerId: provider.providerId,
    userId: input.userId,
  }

  const [challenge] = await db
    .insert(authChallenge)
    .values({
      purpose: OAUTH_PURPOSE,
      identifier: state,
      challenge: state,
      payload,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    })
    .returning({ id: authChallenge.id })
  if (!challenge) throw new Error("Could not start OAuth flow.")

  return { browserNonce, url: url.toString() }
}

export async function finishOAuthCallback(
  c: Context,
  providerId: string,
): Promise<{ redirectTo: string }> {
  const provider = requireEnabledProvider(providerId)
  const currentURL = new URL(c.req.url)
  const state = currentURL.searchParams.get("state")
  if (!state) throw new Error("Missing OAuth state.")

  const challenge = await consumeOAuthChallenge(state)
  const payload = challenge.payload as OAuthChallengePayload
  const browserNonce = readOAuthStateCookie(c, provider.providerId)
  clearOAuthStateCookie(c, provider.providerId)
  try {
    if (payload.providerId !== provider.providerId) {
      throw new Error("OAuth provider changed during sign-in.")
    }
    if (browserNonce !== payload.browserNonce) {
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
      if (!session || session.user.id !== payload.userId) {
        throw new Error("Sign in again before linking this account.")
      }
      await linkAccountToUser({
        profile,
        provider,
        tokens: storedTokens(tokens),
        userId: session.user.id,
      })
      return { redirectTo: payload.callbackURL }
    }

    const userId = await resolveSignInUser({
      profile,
      provider,
      tokens: storedTokens(tokens),
    })
    const { token } = await createSession(c, userId)
    setSessionCookies(c, token)
    return { redirectTo: payload.callbackURL }
  } catch (cause) {
    logger.warn(
      `${payload.mode} callback failed for ${provider.providerId}:`,
      errorDetail(cause, "Unknown OAuth callback error"),
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
