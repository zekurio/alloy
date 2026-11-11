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
  callbackURLWithOAuthError,
  callbackURLWithWelcome,
  loginURLWithAccountReactivation,
  loginURLWithOAuthError,
  loginURLWithOAuthLink,
  normalizeCallbackURL,
  oauthClient,
  oauthErrorLogDetail,
  oidcCallbackURL,
  scopesForProvider,
} from "./oauth-client"
import { requireUsableOidcProvider } from "./oauth-config"
import { savePendingOAuthLink } from "./oauth-pending-link"
import { profileFromTokens } from "./oauth-profile"
import type { OAuthChallengePayload, OAuthMode } from "./oauth-types"
import { getSession } from "./session"
import { SETUP_ADMIN_CLAIM_REQUIRED, setupRequired } from "./setup"

const logger = createLogger("oauth")
const OAuthChallengePayloadSchema = t.object({
  browserNonce: t.string(),
  callbackURL: t.string(),
  codeVerifier: t.string().optional(),
  mode: t.enum(["sign-in", "link"]),
  userId: t.string().optional(),
})

export { fallbackOAuthErrorRedirect } from "./oauth-client"

export async function startOAuthSignIn(input: {
  callbackURL?: string | null
}): Promise<{ browserNonce: string; url: string }> {
  return startOAuthFlow({ ...input, mode: "sign-in" })
}

export async function startOAuthLink(input: {
  callbackURL?: string | null
  userId: string
}): Promise<{ browserNonce: string; url: string }> {
  return startOAuthFlow({ ...input, mode: "link" })
}

async function startOAuthFlow(input: {
  callbackURL?: string | null
  mode: OAuthMode
  userId?: string
}): Promise<{ browserNonce: string; url: string }> {
  const provider = requireUsableOidcProvider()

  const state = randomState()
  const browserNonce = randomState()
  const codeVerifier = provider.pkce ? randomPKCECodeVerifier() : undefined
  const callbackURL = normalizeCallbackURL(input.callbackURL)
  const config = await oauthClient(provider)
  const scope = scopesForProvider(provider)

  const params = new URLSearchParams({
    ...provider.authParams,
    redirect_uri: oidcCallbackURL(),
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
    mode: input.mode,
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
): Promise<{ redirectTo: string }> {
  // Clear the single-use state cookie up front so no failure below leaves it,
  // including a provider that was disabled while the flow was in progress.
  const browserNonce = readOAuthStateCookie(c)
  clearOAuthStateCookie(c)
  const provider = requireUsableOidcProvider()
  const currentURL = new URL(c.req.url)
  const state = currentURL.searchParams.get("state")
  if (!state) throw new Error("Missing OAuth state.")

  const challenge = await consumeOAuthChallenge(state)
  const payload = requireOAuthChallengePayload(challenge.payload)
  try {
    if (!browserNonceMatches(browserNonce, payload.browserNonce)) {
      throw new Error("OAuth sign-in did not start in this browser.")
    }

    const callbackURL = new URL(oidcCallbackURL())
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
      await linkAccountToUser({ profile, userId: session.user.id })
      logger.info(`linked OIDC account to user ${session.user.id}`)
      return { redirectTo: payload.callbackURL }
    }

    // Until an admin exists, the provider decides who becomes one: only an
    // identity its role claim marks as admin gets in, and no setup token is
    // asked for.
    if (setupRequired()) {
      if (profile.role !== "admin") {
        logger.warn(
          `refused an OIDC sign-in during setup: its ${provider.roleClaim} claim does not say admin`,
        )
        throw new Error(SETUP_ADMIN_CLAIM_REQUIRED)
      }
      const userId = await createFirstAdminForOAuthAccount(profile)
      logger.info(`OIDC sign-in created admin ${userId}`)
      await completeAuthenticatedSignIn(c, userId)
      return { redirectTo: payload.callbackURL }
    }

    const resolved = await resolveSignInUser({ profile, provider })
    if (resolved.kind === "link-required") {
      logger.info(
        `OIDC sign-in matched the username of user ${resolved.userId}; asking to link`,
      )
      const pendingToken = await savePendingOAuthLink({
        callbackURL: payload.callbackURL,
        profile,
      })
      setOAuthPendingLinkCookie(c, pendingToken)
      return { redirectTo: loginURLWithOAuthLink(payload.callbackURL) }
    }
    const { kind, userId } = resolved
    logger.info(`OIDC sign-in ${kind} user ${userId}`)
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
      // A new or claimed account is this person's first time in.
      redirectTo:
        kind === "matched"
          ? payload.callbackURL
          : callbackURLWithWelcome(payload.callbackURL),
    }
  } catch (cause) {
    logger.warn(
      `OIDC ${payload.mode} callback failed:`,
      oauthErrorLogDetail(cause),
    )
    // A failed link keeps the user signed in, so send them back to where they
    // started (settings). Other failed sign-ins leave them logged out, so
    // route to /login where the error toast can actually surface. During
    // setup /login redirects to /setup, so those errors go back to where the
    // sign-in started.
    return {
      redirectTo:
        payload.mode === "link" || setupRequired()
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
