import {
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_LINK_QUERY_KEY,
  type OAuthProviderConfig,
  WELCOME_QUERY_KEY,
} from "@alloy/contracts"
import { secretStore } from "@alloy/server/config/secret-store"
import { configStore } from "@alloy/server/config/store"
import { env } from "@alloy/server/env"
import { errorDetail, errorMessage } from "@alloy/server/runtime/error-message"
import { DrizzleQueryError } from "drizzle-orm"
import {
  allowInsecureRequests,
  AuthorizationResponseError,
  ClientError,
  ClientSecretBasic,
  ClientSecretPost,
  Configuration,
  type ClientAuth,
  discovery,
  fetchUserInfo,
  type JsonObject,
  type JsonValue,
  ResponseBodyError,
  type ServerMetadata,
  skipSubjectCheck,
} from "openid-client"

import { getEnabledProviderConfig } from "./oauth-config"

const oauthClientCache = new Map<string, Promise<Configuration>>()
const USER_INFO_TIMEOUT_MS = 10_000
// Visible ASCII only (RFC 7230 header values with no whitespace).
const BEARER_TOKEN_PATTERN = /^[\x21-\x7E]+$/

// Provider metadata and secrets are runtime-mutable (admin settings). Drop
// discovered client configurations on any config change so the next sign-in
// re-discovers with the current endpoints and secret.
configStore.subscribe(() => oauthClientCache.clear())

export function requireEnabledProvider(
  providerId: string,
): OAuthProviderConfig {
  const provider = getEnabledProviderConfig(providerId)
  if (!provider) {
    throw new Error("OAuth provider is not enabled.")
  }
  return provider
}

export async function oauthClient(
  provider: OAuthProviderConfig,
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
  provider: OAuthProviderConfig,
): Promise<Configuration> {
  const clientSecret = secretStore.oidcClientSecret()
  const metadata = {
    client_secret: clientSecret,
  }
  const clientAuth = clientAuthForProvider(provider, clientSecret)
  if (provider.issuerUrl) {
    return discovery(
      new URL(provider.issuerUrl),
      provider.clientId,
      metadata,
      clientAuth,
      insecureOptions(provider.issuerUrl),
    )
  }

  if (!provider.authorizationUrl || !provider.tokenUrl) {
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
    clientAuth,
  )
  if (usesInsecureEndpoint(provider)) allowInsecureRequests(config)
  return config
}

export async function fetchOAuthUserInfo(
  config: Configuration,
  provider: OAuthProviderConfig,
  accessToken: string,
  expectedSubject: string | typeof skipSubjectCheck,
): Promise<JsonObject> {
  // Bearer tokens are visible ASCII. Anything else makes Headers throw a
  // TypeError that quotes the whole Authorization header, token included,
  // on both the openid-client path and the plain fetch below.
  if (!BEARER_TOKEN_PATTERN.test(accessToken)) {
    throw new Error("OAuth provider returned a malformed access token.")
  }
  if (providerUsesOpenId(provider)) {
    return await fetchUserInfo(config, accessToken, expectedSubject)
  }

  if (!provider.userInfoUrl) return {}

  // One deadline covers headers and body: a provider that stalls mid-response
  // must not pin the login request forever.
  const res = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `OAuth provider user info request failed with HTTP ${res.status}.`,
    )
  }
  // SAFETY: Response.json() accepts only JSON values after syntax validation.
  const body = (await res.json()) as JsonValue
  return body && body instanceof Object && !Array.isArray(body) ? body : {}
}

function oauthClientCacheKey(provider: OAuthProviderConfig): string {
  return JSON.stringify({
    authorizationUrl: provider.authorizationUrl,
    clientId: provider.clientId,
    clientSecret: secretStore.oidcClientSecret(),
    issuerUrl: provider.issuerUrl,
    providerId: provider.providerId,
    tokenAuthMethod: provider.tokenAuthMethod,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl,
  })
}

function clientAuthForProvider(
  provider: OAuthProviderConfig,
  clientSecret: string,
): ClientAuth {
  if (provider.tokenAuthMethod === OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD) {
    return ClientSecretBasic(clientSecret)
  }
  return ClientSecretPost(clientSecret)
}

function insecureOptions(url: string) {
  return new URL(url).protocol === "http:"
    ? { execute: [allowInsecureRequests] }
    : undefined
}

function usesInsecureEndpoint(provider: OAuthProviderConfig): boolean {
  return [
    provider.issuerUrl,
    provider.authorizationUrl,
    provider.tokenUrl,
    provider.userInfoUrl,
  ].some((value) => value && new URL(value).protocol === "http:")
}

export function scopesForProvider(provider: OAuthProviderConfig): string {
  return provider.scopes.join(" ")
}

function providerUsesOpenId(provider: OAuthProviderConfig): boolean {
  return scopesForProvider(provider).split(/\s+/).includes("openid")
}

export function callbackURLForProvider(providerId: string): string {
  return `${env.PUBLIC_SERVER_URL}/api/auth/oauth2/callback/${providerId}`
}

export function normalizeCallbackURL(value: string | null | undefined): string {
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
    cause,
  )
}

export function callbackURLWithOAuthError(
  callbackURL: string,
  cause: unknown,
): string {
  const url = new URL(callbackURL)
  url.searchParams.set("oauth_error", oauthErrorMessage(cause))
  return url.toString()
}

export function callbackURLWithWelcome(
  callbackURL: string,
  providerId: string,
): string {
  const url = new URL(callbackURL)
  url.searchParams.set(WELCOME_QUERY_KEY, providerId)
  return url.toString()
}

export function loginURLWithAccountReactivation(callbackURL: string): string {
  return loginURLReturningTo(callbackURL, { reactivate: "true" })
}

/** Send the user to sign in and link the provider from there. */
export function loginURLWithOAuthLink(
  callbackURL: string,
  providerId: string,
): string {
  return loginURLReturningTo(callbackURL, {
    [OAUTH_LINK_QUERY_KEY]: providerId,
  })
}

function loginURLReturningTo(
  callbackURL: string,
  params: Record<string, string>,
): string {
  const callback = new URL(callbackURL)
  const login = new URL("/login", callback.origin)
  for (const [key, value] of Object.entries(params)) {
    login.searchParams.set(key, value)
  }

  const redirect = `${callback.pathname}${callback.search}`
  if (redirect !== "/") login.searchParams.set("redirect", redirect)
  return login.toString()
}

/**
 * Build an error redirect aimed at the login page on the sign-in callback's
 * own origin. A failed sign-in leaves the visitor logged out, so the original
 * callback (typically the home feed) is the wrong target: on instances that
 * require auth to browse it bounces straight to `/login` and drops the
 * `oauth_error` query param on the way, swallowing the toast. Sending them to
 * `/login` directly keeps the error visible regardless of browse policy.
 */
export function loginURLWithOAuthError(
  callbackURL: string,
  cause: unknown,
): string {
  const url = new URL(callbackURL)
  url.pathname = "/login"
  url.search = ""
  url.hash = ""
  url.searchParams.set("oauth_error", oauthErrorMessage(cause))
  return url.toString()
}

/** A failed OAuth step's message, safe to show in the browser. */
export function oauthErrorMessage(cause: unknown): string {
  if (cause instanceof ResponseBodyError) {
    return providerErrorMessage(
      "OAuth provider rejected the request",
      cause.error,
      cause.error_description,
      cause.status,
    )
  }

  if (cause instanceof AuthorizationResponseError) {
    return providerErrorMessage(
      "OAuth provider rejected the sign-in",
      cause.error,
      cause.error_description,
    )
  }

  // Only Alloy's own plain errors and openid-client's fixed messages reach the
  // browser. Other messages can quote secrets: a failed query's message is its
  // SQL plus bound params (the provider's tokens on account writes), and fetch
  // rejects a malformed token by quoting the Authorization header.
  if (
    cause instanceof ClientError ||
    (cause instanceof Error && Object.getPrototypeOf(cause) === Error.prototype)
  ) {
    return errorMessage(cause, "OAuth sign-in failed.")
  }
  return "OAuth sign-in failed."
}

/** Log detail for a failed callback that leaves out query params. */
export function oauthErrorLogDetail(cause: unknown): string {
  if (cause instanceof DrizzleQueryError) {
    return errorDetail(cause.cause, "Database query failed")
  }
  return errorDetail(cause, "Unknown OAuth callback error")
}

function providerErrorMessage(
  prefix: string,
  error: string,
  description?: string,
  status?: number,
): string {
  const detail = description ? `${error}: ${description}` : error
  return status ? `${prefix} (${status}): ${detail}` : `${prefix}: ${detail}`
}
