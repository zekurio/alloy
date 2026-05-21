import {
  AuthorizationResponseError,
  ClientSecretPost,
  Configuration,
  ResponseBodyError,
  allowInsecureRequests,
  discovery,
  fetchUserInfo,
  type ServerMetadata,
  type UserInfoResponse,
} from "openid-client"

import type { OAuthProviderConfig } from "../config/store"
import { env } from "../env"
import { getEnabledProviderConfig } from "./oauth-config"

const oauthClientCache = new Map<string, Promise<Configuration>>()

export function requireEnabledProvider(
  providerId: string
): OAuthProviderConfig {
  const provider = getEnabledProviderConfig()
  if (!provider || provider.providerId !== providerId) {
    throw new Error("OAuth provider is not enabled.")
  }
  return provider
}

export async function oauthClient(
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

export async function fetchLinkedUserInfo(
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

export function scopesForProvider(provider: OAuthProviderConfig): string {
  const scopes = provider.scopes?.map((scope) => scope.trim()).filter(Boolean)
  return scopes && scopes.length > 0 ? scopes.join(" ") : "openid profile email"
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
    cause
  )
}

export function callbackURLWithOAuthError(
  callbackURL: string,
  cause: unknown
): string {
  const url = new URL(callbackURL)
  url.searchParams.set("oauth_error", oauthErrorMessage(cause))
  return url.toString()
}

function oauthErrorMessage(cause: unknown): string {
  if (cause instanceof ResponseBodyError) {
    return providerErrorMessage(
      "OAuth provider rejected the request",
      cause.error,
      cause.error_description,
      cause.status
    )
  }

  if (cause instanceof AuthorizationResponseError) {
    return providerErrorMessage(
      "OAuth provider rejected the sign-in",
      cause.error,
      cause.error_description
    )
  }

  return cause instanceof Error ? cause.message : "OAuth sign-in failed."
}

function providerErrorMessage(
  prefix: string,
  error: string,
  description?: string,
  status?: number
): string {
  const detail = description ? `${error}: ${description}` : error
  return status ? `${prefix} (${status}): ${detail}` : `${prefix}: ${detail}`
}
