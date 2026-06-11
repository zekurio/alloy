import type { OAuthProviderConfig } from "@alloy/contracts"
import { secretStore } from "@alloy/server/config/secret-store"
import { env } from "@alloy/server/env"
import { errorMessage } from "@alloy/server/runtime/error-message"
import {
  allowInsecureRequests,
  AuthorizationResponseError,
  ClientSecretPost,
  Configuration,
  discovery,
  fetchUserInfo,
  ResponseBodyError,
  type ServerMetadata,
  skipSubjectCheck,
} from "openid-client"

import { getEnabledProviderConfig } from "./oauth-config"

const oauthClientCache = new Map<string, Promise<Configuration>>()

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
  const clientSecret = secretStore.oauthClientSecret(provider.providerId)
  const metadata = {
    client_secret: clientSecret,
  }
  if (provider.discoveryUrl) {
    return discovery(
      new URL(provider.discoveryUrl),
      provider.clientId,
      metadata,
      ClientSecretPost(clientSecret),
      insecureOptions(provider.discoveryUrl),
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
    ClientSecretPost(clientSecret),
  )
  if (usesInsecureEndpoint(provider)) allowInsecureRequests(config)
  return config
}

export async function fetchOAuthUserInfo(
  config: Configuration,
  provider: OAuthProviderConfig,
  accessToken: string,
  expectedSubject: string | typeof skipSubjectCheck,
): Promise<Record<string, unknown>> {
  if (providerUsesOpenId(provider)) {
    return await fetchUserInfo(config, accessToken, expectedSubject)
  }

  if (!provider.userInfoUrl) return {}

  const res = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) {
    throw new Error(
      `OAuth provider user info request failed with HTTP ${res.status}.`,
    )
  }
  const body = await res.json()
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

function oauthClientCacheKey(provider: OAuthProviderConfig): string {
  return JSON.stringify({
    authorizationUrl: provider.authorizationUrl,
    clientId: provider.clientId,
    clientSecret: secretStore.oauthClientSecret(provider.providerId),
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

export function scopesForProvider(provider: OAuthProviderConfig): string {
  const scopes = provider.scopes?.map((scope) => scope.trim()).filter(Boolean)
  return scopes && scopes.length > 0 ? scopes.join(" ") : "openid profile email"
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

function oauthErrorMessage(cause: unknown): string {
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

  return errorMessage(cause, "OAuth sign-in failed.")
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
