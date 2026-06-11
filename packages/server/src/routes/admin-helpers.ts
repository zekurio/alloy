import type {
  AdminOAuthProvider,
  AdminRuntimeConfig,
  OAuthProviderConfig,
  RuntimeConfig,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import {
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
} from "@alloy/server/config/oauth-schema"
import { secretStore } from "@alloy/server/config/secret-store"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import { selectSourceStorageUsedBytesByUserIds } from "@alloy/server/storage/quota"
import { and, desc, inArray, ne, sql } from "drizzle-orm"

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
    storage: {
      ...config.storage,
      s3AccessKeyIdSet: secretStore.get("storageS3AccessKeyId").length > 0,
      s3SecretAccessKeySet:
        secretStore.get("storageS3SecretAccessKey").length > 0,
    },
    integrations: {
      steamgriddbApiKeySet: secretStore.get("steamgriddbApiKey").length > 0,
    },
    authBaseURL: env.PUBLIC_SERVER_URL,
  }
}

async function selectClipCountsByUserIds(
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map()

  const rows = await db
    .select({
      userId: clip.authorId,
      count: sql<number>`count(*)::int`,
    })
    .from(clip)
    .where(and(inArray(clip.authorId, userIds), ne(clip.status, "failed")))
    .groupBy(clip.authorId)

  return new Map(rows.map((row) => [row.userId, row.count]))
}

export async function selectAdminUserStorageRows(targetUserIds?: string[]) {
  const rows = await db
    .select({
      id: user.id,
      username: user.username,
      email: user.email,
      image: user.image,
      role: user.role,
      status: user.status,
      disabledAt: user.disabledAt,
      createdAt: user.createdAt,
      storageQuotaBytes: user.storageQuotaBytes,
    })
    .from(user)
    .where(targetUserIds ? inArray(user.id, targetUserIds) : undefined)
    .orderBy(desc(user.createdAt))
    .limit(targetUserIds ? targetUserIds.length : 100)

  const userIds = rows.map((row) => row.id)
  const [usage, clipCounts] = await Promise.all([
    selectSourceStorageUsedBytesByUserIds(db, userIds),
    selectClipCountsByUserIds(userIds),
  ])

  return rows.map((row) => ({
    ...row,
    createdAt: isoDate(row.createdAt),
    disabledAt: nullableIsoDate(row.disabledAt),
    storageUsedBytes: usage.get(row.id) ?? 0,
    clipCount: clipCounts.get(row.id) ?? 0,
  }))
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
    providerId:
      typeof provider.providerId === "string"
        ? provider.providerId.trim()
        : provider.providerId,
    displayName:
      typeof provider.displayName === "string"
        ? provider.displayName.trim()
        : provider.displayName,
    clientId:
      typeof provider.clientId === "string"
        ? provider.clientId.trim()
        : provider.clientId,
    clientSecret:
      typeof provider.clientSecret === "string"
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
    newClientSecret:
      trimmedSecret && trimmedSecret.length > 0 ? trimmedSecret : undefined,
  }
}
