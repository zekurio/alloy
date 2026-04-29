import {
  ClientSecretPost,
  Configuration,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  fetchUserInfo,
  randomPKCECodeVerifier,
  randomState,
  skipSubjectCheck,
  type ServerMetadata,
  type TokenEndpointResponse,
  type UserInfoResponse,
} from "openid-client"
import { and, eq, gt, lt } from "drizzle-orm"
import type { Context } from "hono"

import { authAccount, authChallenge, user } from "@workspace/db/auth-schema"
import { OAUTH_QUOTA_CLAIM_DEFAULT } from "@workspace/contracts"

import { configStore, type OAuthProviderConfig } from "../config/store"
import { db } from "../db"
import { env } from "../env"
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setSessionCookies,
} from "./cookies"
import { findUserByEmail, normalizeEmail } from "./identity"
import { getEnabledProviderConfig, imageFromProfile } from "./oauth-config"
import { createSession, getSession } from "./session"
import { generateUniqueUsername, slugifyUsername } from "./username"

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const OAUTH_PURPOSE = "oauth-state"
const GIB = 1024 ** 3
const oauthClientCache = new Map<string, Promise<Configuration>>()

type OAuthMode = "sign-in" | "link"

type OAuthChallengePayload = {
  browserNonce: string
  callbackURL: string
  codeVerifier?: string
  mode: OAuthMode
  providerId: string
  userId?: string
}

type OAuthProfile = {
  email: string | null
  emailVerified: boolean
  name: string
  picture: string | null
  providerAccountId: string
  raw: Record<string, unknown>
  storageQuotaBytes: number | null | undefined
  usernameHint: string | null
}

type StoredTokens = {
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  accessTokenExpiresAt: Date | null
  scope: string | null
}

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
  providerId: string
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
    return {
      redirectTo: callbackURLWithOAuthError(payload.callbackURL, cause),
    }
  }
}

export async function syncLinkedOAuthImage(userId: string): Promise<{
  image: string | null
  synced: boolean
}> {
  const provider = getEnabledProviderConfig()
  if (!provider) return { image: null, synced: false }

  const [account] = await db
    .select()
    .from(authAccount)
    .where(
      and(
        eq(authAccount.userId, userId),
        eq(authAccount.providerId, provider.providerId)
      )
    )
    .limit(1)
  if (!account?.accessToken) return { image: null, synced: false }
  if (
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() <= Date.now()
  ) {
    return { image: null, synced: false }
  }

  const userInfo = await fetchLinkedUserInfo(
    provider,
    account.accessToken,
    account.providerAccountId
  )
  if (!userInfo) return { image: null, synced: false }

  const image = imageFromProfile(userInfo)
  if (!image) return { image: null, synced: false }

  await db
    .update(user)
    .set({ image, updatedAt: new Date() })
    .where(eq(user.id, userId))
  return { image, synced: true }
}

function requireEnabledProvider(providerId: string): OAuthProviderConfig {
  const provider = getEnabledProviderConfig()
  if (!provider || provider.providerId !== providerId) {
    throw new Error("OAuth provider is not enabled.")
  }
  return provider
}

async function oauthClient(
  provider: OAuthProviderConfig
): Promise<Configuration> {
  const key = oauthClientCacheKey(provider)
  const cached = oauthClientCache.get(key)
  if (cached) return cached

  const clientPromise = createOAuthClient(provider).catch((cause) => {
    oauthClientCache.delete(key)
    throw cause
  })
  oauthClientCache.set(key, clientPromise)
  return clientPromise
}

async function createOAuthClient(
  provider: OAuthProviderConfig
): Promise<Configuration> {
  const metadata = {
    client_secret: provider.clientSecret,
  }
  if (provider.discoveryUrl) {
    return discovery(
      new URL(provider.discoveryUrl),
      provider.clientId,
      metadata,
      ClientSecretPost(provider.clientSecret),
      insecureOptions(provider.discoveryUrl)
    )
  }

  if (
    !provider.authorizationUrl ||
    !provider.tokenUrl ||
    !provider.userInfoUrl
  ) {
    throw new Error("OAuth provider endpoints are incomplete.")
  }

  const server: ServerMetadata = {
    issuer: new URL(provider.authorizationUrl).origin,
    authorization_endpoint: provider.authorizationUrl,
    token_endpoint: provider.tokenUrl,
    userinfo_endpoint: provider.userInfoUrl,
  }
  const config = new Configuration(
    server,
    provider.clientId,
    metadata,
    ClientSecretPost(provider.clientSecret)
  )
  if (usesInsecureEndpoint(provider)) allowInsecureRequests(config)
  return config
}

async function fetchLinkedUserInfo(
  provider: OAuthProviderConfig,
  accessToken: string,
  providerAccountId: string
): Promise<UserInfoResponse | null> {
  try {
    const config = await oauthClient(provider)
    return await fetchUserInfo(config, accessToken, providerAccountId)
  } catch (cause) {
    console.warn(
      "[oauth] could not sync linked profile:",
      cause instanceof Error ? cause.message : cause
    )
    return null
  }
}

function oauthClientCacheKey(provider: OAuthProviderConfig): string {
  return JSON.stringify({
    authorizationUrl: provider.authorizationUrl,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    discoveryUrl: provider.discoveryUrl,
    providerId: provider.providerId,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl,
  })
}

function insecureOptions(url: string) {
  return new URL(url).protocol === "http:"
    ? { execute: [allowInsecureRequests] }
    : undefined
}

function usesInsecureEndpoint(provider: OAuthProviderConfig): boolean {
  return [
    provider.discoveryUrl,
    provider.authorizationUrl,
    provider.tokenUrl,
    provider.userInfoUrl,
  ].some((value) => value && new URL(value).protocol === "http:")
}

function scopesForProvider(provider: OAuthProviderConfig): string {
  const scopes = provider.scopes?.map((scope) => scope.trim()).filter(Boolean)
  return scopes && scopes.length > 0 ? scopes.join(" ") : "openid profile email"
}

function callbackURLForProvider(providerId: string): string {
  return `${env.PUBLIC_SERVER_URL}/api/auth/oauth2/callback/${providerId}`
}

function normalizeCallbackURL(value: string | null | undefined): string {
  const fallback = env.PUBLIC_SERVER_URL
  if (!value) return fallback

  const url = new URL(value, fallback)
  url.hash = ""
  const allowedOrigins = new Set([
    new URL(env.PUBLIC_SERVER_URL).origin,
    ...env.TRUSTED_ORIGINS.map((origin) => new URL(origin).origin),
  ])
  if (!allowedOrigins.has(url.origin)) {
    throw new Error("OAuth callback URL is not trusted.")
  }
  return url.toString()
}

export function fallbackOAuthErrorRedirect(cause: unknown): string {
  return callbackURLWithOAuthError(
    new URL("/login", env.PUBLIC_SERVER_URL).toString(),
    cause
  )
}

function callbackURLWithOAuthError(callbackURL: string, cause: unknown): string {
  const url = new URL(callbackURL)
  url.searchParams.set(
    "oauth_error",
    cause instanceof Error ? cause.message : "OAuth sign-in failed."
  )
  return url.toString()
}

async function deleteExpiredOAuthChallenges(): Promise<void> {
  await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, OAUTH_PURPOSE),
        lt(authChallenge.expiresAt, new Date())
      )
    )
}

async function consumeOAuthChallenge(state: string) {
  const [challenge] = await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, OAUTH_PURPOSE),
        eq(authChallenge.identifier, state),
        eq(authChallenge.challenge, state),
        gt(authChallenge.expiresAt, new Date())
      )
    )
    .returning()
  if (!challenge) throw new Error("OAuth sign-in expired. Try again.")
  return challenge
}

async function profileFromTokens(
  config: Configuration,
  provider: OAuthProviderConfig,
  tokens: TokenEndpointResponse & {
    claims(): Record<string, unknown> | undefined
  }
): Promise<OAuthProfile> {
  const claims = tokens.claims() ?? {}
  const expectedSubject =
    typeof claims.sub === "string" ? claims.sub : skipSubjectCheck
  const userInfo = tokens.access_token
    ? await fetchUserInfo(config, tokens.access_token, expectedSubject)
    : ({} as UserInfoResponse)
  const raw = { ...claims, ...userInfo }
  const providerAccountId = stringClaim(raw, "sub")
  const email = stringClaim(raw, "email")
  const usernameHint = stringClaim(raw, provider.usernameClaim ?? "")

  if (!providerAccountId) throw new Error("OAuth profile is missing a subject.")

  return {
    email: email ? normalizeEmail(email) : null,
    emailVerified: raw.email_verified === true,
    name:
      stringClaim(raw, "name") ??
      stringClaim(raw, "display_name") ??
      stringClaim(raw, "nickname") ??
      usernameHint ??
      email ??
      "Alloy user",
    picture: imageFromProfile(raw) ?? null,
    providerAccountId,
    raw,
    storageQuotaBytes: quotaFromProfile(raw, provider.quotaClaim),
    usernameHint,
  }
}

async function resolveSignInUser(input: {
  profile: OAuthProfile
  provider: OAuthProviderConfig
  tokens: StoredTokens
}): Promise<string> {
  const existingAccount = await findLinkedAccount(
    input.provider.providerId,
    input.profile.providerAccountId
  )
  if (existingAccount) {
    await updateLinkedAccount(existingAccount.id, input.profile, input.tokens)
    return existingAccount.userId
  }

  if (!input.profile.email) {
    throw new Error("OAuth profile is missing an email address.")
  }

  const existingUser = await findUserByEmail(input.profile.email)
  if (existingUser && !input.profile.emailVerified) {
    throw new Error(
      "An account already exists for that email. Sign in and link this provider from settings."
    )
  }
  if (!existingUser && !configStore.get("openRegistrations")) {
    throw new Error("Sign-up is currently closed.")
  }

  return db.transaction(async (tx) => {
    const row =
      existingUser ??
      (await createOAuthUser(input.profile, async (values) => {
        const [created] = await tx.insert(user).values(values).returning()
        if (!created) throw new Error("Could not create user.")
        return created
      }))

    const [linked] = await tx
      .insert(authAccount)
      .values(
        accountValues(
          row.id,
          input.provider.providerId,
          input.profile,
          input.tokens
        )
      )
      .onConflictDoNothing()
      .returning({ id: authAccount.id })

    if (!linked) {
      const account = await findLinkedAccount(
        input.provider.providerId,
        input.profile.providerAccountId
      )
      if (!account) throw new Error("Could not link OAuth account.")
      if (account.userId !== row.id) {
        throw new Error("OAuth account is already linked to another user.")
      }
      await updateLinkedAccount(account.id, input.profile, input.tokens)
    }

    return row.id
  })
}

async function linkAccountToUser(input: {
  profile: OAuthProfile
  provider: OAuthProviderConfig
  tokens: StoredTokens
  userId: string
}): Promise<void> {
  const existing = await findLinkedAccount(
    input.provider.providerId,
    input.profile.providerAccountId
  )
  if (existing && existing.userId !== input.userId) {
    throw new Error("OAuth account is already linked to another user.")
  }
  if (existing) {
    await updateLinkedAccount(existing.id, input.profile, input.tokens)
    return
  }

  await db.insert(authAccount).values(
    accountValues(
      input.userId,
      input.provider.providerId,
      input.profile,
      input.tokens
    )
  )
  if (input.profile.picture) {
    await db
      .update(user)
      .set({ image: input.profile.picture, updatedAt: new Date() })
      .where(eq(user.id, input.userId))
  }
}

async function findLinkedAccount(
  providerId: string,
  providerAccountId: string
) {
  const [account] = await db
    .select()
    .from(authAccount)
    .where(
      and(
        eq(authAccount.providerId, providerId),
        eq(authAccount.providerAccountId, providerAccountId)
      )
    )
    .limit(1)
  return account ?? null
}

async function updateLinkedAccount(
  accountId: string,
  profile: OAuthProfile,
  tokens: StoredTokens
): Promise<void> {
  await db
    .update(authAccount)
    .set({
      email: profile.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      scope: tokens.scope,
      updatedAt: new Date(),
    })
    .where(eq(authAccount.id, accountId))
}

async function createOAuthUser(
  profile: OAuthProfile,
  insert: (values: typeof user.$inferInsert) => Promise<typeof user.$inferSelect>
) {
  if (!profile.email) {
    throw new Error("OAuth profile is missing an email address.")
  }
  const username = await generateUniqueUsername({
    email: profile.email,
    name: profile.usernameHint
      ? slugifyUsername(profile.usernameHint)
      : profile.name,
  })
  return insert({
    email: profile.email,
    emailVerified: profile.emailVerified,
    username,
    name: profile.name,
    image: profile.picture,
    storageQuotaBytes:
      profile.storageQuotaBytes === undefined
        ? configStore.get("limits").defaultStorageQuotaBytes
        : profile.storageQuotaBytes,
  })
}

function accountValues(
  userId: string,
  providerId: string,
  profile: OAuthProfile,
  tokens: StoredTokens
): typeof authAccount.$inferInsert {
  return {
    userId,
    providerId,
    providerAccountId: profile.providerAccountId,
    email: profile.email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    scope: tokens.scope,
  }
}

function storedTokens(
  tokens: TokenEndpointResponse & { expiresIn(): number | undefined }
): StoredTokens {
  const expiresIn = tokens.expiresIn()
  return {
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token ?? null,
    accessTokenExpiresAt:
      expiresIn === undefined ? null : new Date(Date.now() + expiresIn * 1000),
    scope: tokens.scope ?? null,
  }
}

function stringClaim(
  profile: Record<string, unknown>,
  key: string
): string | null {
  if (!key) return null
  const value = profile[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function quotaFromProfile(
  profile: Record<string, unknown>,
  claim = OAUTH_QUOTA_CLAIM_DEFAULT
): number | null | undefined {
  const value = profile[claim]
  if (value === undefined || value === null || value === "") return undefined
  const gib =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(gib) || gib < 0) return undefined
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(gib * GIB))
}
