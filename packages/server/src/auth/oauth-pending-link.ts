import {
  type PendingOAuthLink as PublicPendingOAuthLink,
  USER_ROLES,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import type { AuthChallengePayload } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { randomBase64Url } from "@alloy/server/runtime/crypto"
import type { Context } from "hono"

import {
  type AuthenticatedSignInResult,
  completeAuthenticatedSignIn,
} from "./account-sign-in"
import {
  consumeAuthChallenge,
  findAuthChallenge,
  insertAuthChallenge,
} from "./challenges"
import { createUserForOAuthAccount, linkAccountToUser } from "./oauth-accounts"
import { OAUTH_STATE_TTL_MS } from "./oauth-challenges"
import { callbackURLWithWelcome, requireEnabledProvider } from "./oauth-client"
import type { OAuthProfile, StoredTokens } from "./oauth-types"

// An OAuth sign-in whose username claim named an existing user. The callback
// keeps the identity it already verified so the user can sign in to that
// account and link it, or create a new account, without asking the provider
// again. The HttpOnly cookie holding the token ties it to the browser that
// went through the callback: whoever controls a matching claim at the provider
// can't hand their identity to someone else's session.
const OAUTH_PENDING_LINK_PURPOSE = "oauth-pending-link"
const logger = createLogger("oauth")

const PendingOAuthLinkPayloadSchema = t.object({
  callbackURL: t.string(),
  providerId: t.string(),
  profile: t.object({
    avatarUrl: t.string().nullable(),
    providerAccountId: t.string(),
    role: t.enum(USER_ROLES).optional(),
    storageQuotaBytes: t.number().nullable().optional(),
    usernameHint: t.string().nullable(),
  }),
  tokens: t.object({
    accessToken: t.string().nullable(),
    refreshToken: t.string().nullable(),
    idToken: t.string().nullable(),
    accessTokenExpiresAt: t.iso.datetime().nullable(),
    scope: t.string().nullable(),
  }),
})

type PendingOAuthLink = {
  /** Where the sign-in started, already checked against trusted origins. */
  callbackURL: string
  profile: OAuthProfile
  providerId: string
  tokens: StoredTokens
}

/** Save a sign-in for {@link linkPendingOAuthAccount} and return its token. */
export async function savePendingOAuthLink(
  link: PendingOAuthLink,
): Promise<string> {
  const token = randomBase64Url(32)
  const { accessTokenExpiresAt, ...tokens } = link.tokens
  await insertAuthChallenge({
    purpose: OAUTH_PENDING_LINK_PURPOSE,
    identifier: token,
    challenge: token,
    payload: {
      callbackURL: link.callbackURL,
      providerId: link.providerId,
      profile: link.profile,
      tokens: {
        ...tokens,
        accessTokenExpiresAt: accessTokenExpiresAt?.toISOString() ?? null,
      },
    },
    userId: null,
    ttlMs: OAUTH_STATE_TTL_MS,
  })
  return token
}

/** What the login page shows about the pending link, if there is one. */
export async function readPendingOAuthLink(
  token: string | null,
): Promise<PublicPendingOAuthLink | null> {
  if (!token) return null
  const row = await findAuthChallenge(challengeMatch(token))
  const link = row ? pendingLinkFromPayload(row.payload) : null
  if (!link) return null
  return {
    providerId: link.providerId,
    accountLabel: link.profile.usernameHint,
  }
}

export async function discardPendingOAuthLink(
  token: string | null,
): Promise<void> {
  if (token) await consumeAuthChallenge(challengeMatch(token))
}

/**
 * Link the pending identity to the signed-in user and return where the
 * sign-in started.
 */
export async function linkPendingOAuthAccount(
  token: string | null,
  userId: string,
): Promise<string> {
  const link = await consumePendingOAuthLink(token)
  const provider = requireEnabledProvider(link.providerId)
  await linkAccountToUser({
    profile: link.profile,
    provider,
    tokens: link.tokens,
    userId,
  })
  logger.info(`linked pending ${provider.providerId} account to user ${userId}`)
  return link.callbackURL
}

/** Create a new user for the pending identity instead, and sign them in. */
export async function signUpPendingOAuthAccount(
  c: Context,
  token: string | null,
): Promise<{ signIn: AuthenticatedSignInResult; redirectTo: string }> {
  const link = await consumePendingOAuthLink(token)
  const provider = requireEnabledProvider(link.providerId)
  const userId = await createUserForOAuthAccount({
    profile: link.profile,
    provider,
    tokens: link.tokens,
  })
  logger.info(`${provider.providerId} sign-in created user ${userId}`)
  return {
    signIn: await completeAuthenticatedSignIn(c, userId),
    redirectTo: callbackURLWithWelcome(link.callbackURL, provider.providerId),
  }
}

async function consumePendingOAuthLink(
  token: string | null,
): Promise<PendingOAuthLink> {
  const row = token ? await consumeAuthChallenge(challengeMatch(token)) : null
  const link = row ? pendingLinkFromPayload(row.payload) : null
  if (!link) throw new Error("OAuth sign-in expired. Try again.")
  return link
}

function challengeMatch(token: string) {
  return {
    purpose: OAUTH_PENDING_LINK_PURPOSE,
    identifier: token,
    challenge: token,
  }
}

function pendingLinkFromPayload(
  payload: AuthChallengePayload,
): PendingOAuthLink | null {
  const parsed = PendingOAuthLinkPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  const { accessTokenExpiresAt, ...tokens } = parsed.data.tokens
  return {
    ...parsed.data,
    tokens: {
      ...tokens,
      accessTokenExpiresAt:
        accessTokenExpiresAt === null ? null : new Date(accessTokenExpiresAt),
    },
  }
}
