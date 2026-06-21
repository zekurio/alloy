import type {
  AdminOAuthProvider,
  AdminRuntimeConfig,
  OAuthProviderConfig,
  RuntimeConfig,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { secretStore } from "@alloy/server/config/secret-store"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import { selectSourceStorageUsedBytesByUserIds } from "@alloy/server/storage/quota"
import { and, desc, inArray, ne, sql } from "drizzle-orm"

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
  const s3Credentials = secretStore.storageS3Credentials()
  return {
    ...config,
    oauthProviders: config.oauthProviders.map(toAdminOAuthProvider),
    storage: {
      ...config.storage,
      s3AccessKeyIdSet: Boolean(s3Credentials?.accessKeyId),
      s3SecretAccessKeySet: Boolean(s3Credentials?.secretAccessKey),
    },
    integrations: {
      steamgriddbApiKeySet: secretStore.get("steamgriddbApiKey").length > 0,
      steamgriddbConfigured: secretStore.get("steamgriddbApiKey").length > 0,
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
      userId: clip.author_id,
      count: sql<number>`count(*)::int`,
    })
    .from(clip)
    .where(and(inArray(clip.author_id, userIds), ne(clip.status, "failed")))
    .groupBy(clip.author_id)

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
      disabledAt: user.disabled_at,
      createdAt: user.created_at,
      storageQuotaBytes: user.storage_quota_bytes,
    })
    .from(user)
    .where(targetUserIds ? inArray(user.id, targetUserIds) : undefined)
    .orderBy(desc(user.created_at))
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
