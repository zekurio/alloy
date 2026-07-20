import type {
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminUserStorageRow,
  AdminWebhooksConfig,
  OAuthProviderConfig,
  RuntimeConfig,
  UserStatus,
  WebhooksConfig,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { secretStore } from "@alloy/server/config/secret-store"
import { authEnvLocks } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import { selectSourceStorageUsedBytesByUserIds } from "@alloy/server/storage/quota"
import { and, desc, eq, ilike, inArray, lt, ne, or, sql } from "drizzle-orm"

// The Discord webhook URL embeds a secret token: expose only its presence.
function toAdminWebhooksConfig(config: WebhooksConfig): AdminWebhooksConfig {
  return {
    discord: {
      enabled: config.discord.enabled,
      webhookUrlSet: config.discord.webhookUrl.length > 0,
    },
    generic: config.generic,
  }
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
    storage: config.storage,
    webhooks: toAdminWebhooksConfig(config.webhooks),
    integrations: {
      steamgriddbApiKeySet: secretStore.get("steamgriddbApiKey").length > 0,
      steamgriddbConfigured: secretStore.get("steamgriddbApiKey").length > 0,
    },
    authLocks: authEnvLocks(),
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

const adminUserColumns = {
  id: user.id,
  username: user.username,
  email: user.email,
  image: user.image,
  role: user.role,
  status: user.status,
  disabledAt: user.disabled_at,
  createdAt: user.created_at,
  storageQuotaBytes: user.storage_quota_bytes,
}

interface AdminUserBaseRow {
  id: string
  username: string
  email: string
  image: string | null
  role: string | null
  status: UserStatus
  disabledAt: Date | null
  createdAt: Date
  storageQuotaBytes: number | null
}

async function enrichUserRows(
  rows: AdminUserBaseRow[],
): Promise<AdminUserStorageRow[]> {
  const userIds = rows.map((row) => row.id)
  const [usage, clipCounts] = await Promise.all([
    selectSourceStorageUsedBytesByUserIds(db, userIds),
    selectClipCountsByUserIds(userIds),
  ])

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    image: row.image,
    role: row.role,
    status: row.status,
    createdAt: isoDate(row.createdAt),
    disabledAt: nullableIsoDate(row.disabledAt),
    storageQuotaBytes: row.storageQuotaBytes,
    storageUsedBytes: usage.get(row.id) ?? 0,
    clipCount: clipCounts.get(row.id) ?? 0,
  }))
}

export async function selectAdminUserStorageRows(
  targetUserIds: string[],
): Promise<AdminUserStorageRow[]> {
  const rows = await db
    .select(adminUserColumns)
    .from(user)
    .where(inArray(user.id, targetUserIds))
    .orderBy(desc(user.created_at))
    .limit(targetUserIds.length)
  return enrichUserRows(rows)
}

export interface AdminUserStoragePage {
  users: AdminUserStorageRow[]
  nextCursor: { createdAt: string; id: string } | null
  total: number
}

function adminUserSearch(search: string | undefined) {
  if (!search) return undefined
  const pattern = `%${search}%`
  return or(ilike(user.email, pattern), ilike(user.username, pattern))
}

export async function selectAdminUserStoragePage(options: {
  cursor: { createdAt: string; id: string } | null
  limit: number
  search?: string
}): Promise<AdminUserStoragePage> {
  const searchFilter = adminUserSearch(options.search)
  const pageFilter = options.cursor
    ? and(
        searchFilter,
        or(
          lt(user.created_at, sql`${options.cursor.createdAt}::timestamp`),
          and(
            eq(user.created_at, sql`${options.cursor.createdAt}::timestamp`),
            lt(user.id, options.cursor.id),
          ),
        ),
      )
    : searchFilter

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(user)
    .where(searchFilter)
  const rows = await db
    .select({
      ...adminUserColumns,
      // Full-precision text for the pagination cursor; created_at is a plain
      // timestamp, so it's cast back with ::timestamp on the next page.
      createdAtText: sql<string>`${user.created_at}::text`,
    })
    .from(user)
    .where(pageFilter)
    .orderBy(desc(user.created_at), desc(user.id))
    .limit(options.limit + 1)

  const page = rows.slice(0, options.limit)
  const last = page.at(-1)
  return {
    users: await enrichUserRows(page),
    total,
    nextCursor:
      rows.length > options.limit && last
        ? { createdAt: last.createdAtText, id: last.id }
        : null,
  }
}
