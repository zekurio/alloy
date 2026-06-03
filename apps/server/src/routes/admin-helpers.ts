import { desc, inArray } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"
import type {
  AdminOAuthProvider,
  AdminRuntimeConfig,
} from "@workspace/contracts"

import { db } from "../db"
import { env } from "../env"
import {
  type OAuthProviderConfig,
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
  type RuntimeConfig,
} from "../config/store"
import { secretStore } from "../config/secret-store"
import { isoDate } from "../runtime/date"
import { selectSourceStorageUsedBytesByUserIds } from "../storage/quota"

type OAuthProviderAdminSubmission = Record<string, unknown> & {
  providerId?: string
}

function toAdminOAuthProvider(
  provider: OAuthProviderConfig,
): AdminOAuthProvider {
  return {
    ...provider,
    clientSecretSet: secretStore.hasOAuthClientSecret(provider.providerId),
  }
}

/**
 * Build the admin runtime config response from the (secret-free) stored config
 * plus secret-presence flags. The return type carries no secret values, so no
 * secret can be leaked here by construction.
 */
export function adminRuntimeConfigResponse(
  config: Readonly<RuntimeConfig>,
): AdminRuntimeConfig {
  return {
    ...config,
    oauthProviders: config.oauthProviders.map(toAdminOAuthProvider),
    integrations: {
      steamgriddbApiKeySet: secretStore.get("steamgriddbApiKey").length > 0,
    },
    authBaseURL: env.PUBLIC_SERVER_URL,
  }
}

export async function selectAdminUserStorageRows(targetUserIds?: string[]) {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      image: user.image,
      role: user.role,
      createdAt: user.createdAt,
      storageQuotaBytes: user.storageQuotaBytes,
    })
    .from(user)
    .where(targetUserIds ? inArray(user.id, targetUserIds) : undefined)
    .orderBy(desc(user.createdAt))
    .limit(targetUserIds ? targetUserIds.length : 100)

  const usage = await selectSourceStorageUsedBytesByUserIds(
    db,
    rows.map((row) => row.id),
  )

  return rows.map((row) => ({
    ...row,
    createdAt: isoDate(row.createdAt),
    storageUsedBytes: usage.get(row.id) ?? 0,
  }))
}

export function hasEnabledSignInMethod(config: {
  passkeyEnabled: boolean
  oauthProviders: { enabled: boolean }[]
}): boolean {
  return config.passkeyEnabled ||
    config.oauthProviders.some((provider) => provider.enabled)
}

function sanitizeScopes(scopes: string[] | undefined): string[] | undefined {
  const next = scopes?.map((scope) => scope.trim()).filter(Boolean)
  return next && next.length > 0 ? next : undefined
}

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeOptionalHexColor(value: unknown): unknown {
  const trimmed = normalizeOptionalString(value)
  if (typeof trimmed !== "string") return trimmed
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`
}

function normalizeOAuthProviderSubmission(
  provider: OAuthProviderAdminSubmission,
): Record<string, unknown> {
  return {
    ...provider,
    providerId: typeof provider.providerId === "string"
      ? provider.providerId.trim()
      : provider.providerId,
    displayName: typeof provider.displayName === "string"
      ? provider.displayName.trim()
      : provider.displayName,
    clientId: typeof provider.clientId === "string"
      ? provider.clientId.trim()
      : provider.clientId,
    clientSecret: typeof provider.clientSecret === "string"
      ? provider.clientSecret.trim()
      : provider.clientSecret,
    buttonColor: normalizeOptionalHexColor(provider.buttonColor),
    buttonTextColor: normalizeOptionalHexColor(provider.buttonTextColor),
    iconUrl: normalizeOptionalString(provider.iconUrl),
    scopes: sanitizeScopes(
      Array.isArray(provider.scopes)
        ? provider.scopes.filter(
          (scope): scope is string => typeof scope === "string",
        )
        : undefined,
    ),
    discoveryUrl: normalizeOptionalString(provider.discoveryUrl),
    authorizationUrl: normalizeOptionalString(provider.authorizationUrl),
    tokenUrl: normalizeOptionalString(provider.tokenUrl),
    userInfoUrl: normalizeOptionalString(provider.userInfoUrl),
    usernameClaim: normalizeOptionalString(provider.usernameClaim),
    quotaClaim: normalizeOptionalString(provider.quotaClaim),
    roleClaim: normalizeOptionalString(provider.roleClaim),
  }
}

/**
 * Pull OAuth client secrets that a full/legacy config backup carried inline, so
 * an import can restore them before they're stripped from the stored config.
 * Limited to providers that survive the parse, to avoid orphan secrets.
 */
export function extractImportedOAuthSecrets(
  input: Record<string, unknown>,
  knownProviderIds: ReadonlySet<string>,
): Map<string, string> {
  const secrets = new Map<string, string>()
  if (!Array.isArray(input.oauthProviders)) return secrets
  for (const provider of input.oauthProviders) {
    if (!provider || typeof provider !== "object") continue
    const row = provider as Record<string, unknown>
    if (
      typeof row.providerId === "string" &&
      knownProviderIds.has(row.providerId) &&
      typeof row.clientSecret === "string" &&
      row.clientSecret.length > 0
    ) {
      secrets.set(row.providerId, row.clientSecret)
    }
  }
  return secrets
}

export type FinalizedOAuthProvider = {
  /** Stored metadata (no secret). */
  provider: OAuthProviderConfig
  /** New client secret to persist, or undefined to keep the existing one. */
  newClientSecret?: string
}

/**
 * Normalize and validate an admin OAuth submission into stored metadata plus an
 * optional new client secret. The secret is split out here so it can be written
 * to the secret store and never re-enters the stored config.
 */
export function finalizeOAuthProviderSubmission(
  provider: OAuthProviderAdminSubmission,
): FinalizedOAuthProvider {
  const parsed = OAuthProviderSubmissionSchema.parse(
    normalizeOAuthProviderSubmission(provider),
  )
  const { clientSecret, ...metadata } = parsed
  const trimmedSecret = clientSecret?.trim()
  return {
    provider: OAuthProviderSchema.parse(metadata) as OAuthProviderConfig,
    newClientSecret: trimmedSecret && trimmedSecret.length > 0
      ? trimmedSecret
      : undefined,
  }
}
