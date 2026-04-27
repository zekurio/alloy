import { desc, inArray } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"

import { db } from "../db"
import { env } from "../env"
import {
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
  configStore,
  type OAuthProviderConfig,
  type RuntimeConfig,
  type StorageConfig,
} from "../lib/config-store"
import { selectSourceStorageUsedBytesByUserIds } from "../lib/storage-quota"

export const REDACTED_SENTINEL = "***"

type OAuthProviderAdminSubmission = Record<string, unknown> & {
  providerId?: string
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function redactSecrets(
  config: Readonly<RuntimeConfig>
): Readonly<RuntimeConfig> {
  return {
    ...config,
    integrations: {
      ...config.integrations,
      steamgriddbApiKey: config.integrations.steamgriddbApiKey
        ? REDACTED_SENTINEL
        : "",
    },
    oauthProvider: config.oauthProvider
      ? { ...config.oauthProvider, clientSecret: "" }
      : null,
    storage: {
      ...config.storage,
      fs: {
        ...config.storage.fs,
        hmacSecret: config.storage.fs.hmacSecret ? REDACTED_SENTINEL : "",
      },
      s3: {
        ...config.storage.s3,
        secretAccessKey: config.storage.s3.secretAccessKey
          ? REDACTED_SENTINEL
          : "",
      },
    },
  }
}

export function adminRuntimeConfigResponse(config: Readonly<RuntimeConfig>) {
  return {
    ...redactSecrets(config),
    authBaseURL: env.PUBLIC_SERVER_URL,
  }
}

export function preserveRedactedSecrets(
  input: Record<string, unknown>,
  current: RuntimeConfig
): void {
  if (input.integrations && typeof input.integrations === "object") {
    const integrations = input.integrations as Record<string, unknown>
    if (integrations.steamgriddbApiKey === REDACTED_SENTINEL) {
      integrations.steamgriddbApiKey = current.integrations.steamgriddbApiKey
    }
  }
  if (input.oauthProvider && typeof input.oauthProvider === "object") {
    const provider = input.oauthProvider as Record<string, unknown>
    if (!provider.clientSecret || provider.clientSecret === "") {
      provider.clientSecret = current.oauthProvider?.clientSecret ?? ""
    }
  }
  if (input.storage && typeof input.storage === "object") {
    const storage = input.storage as Record<string, unknown>
    if (storage.fs && typeof storage.fs === "object") {
      const fs = storage.fs as Record<string, unknown>
      if (fs.hmacSecret === REDACTED_SENTINEL) {
        fs.hmacSecret = current.storage.fs.hmacSecret
      }
    }
    if (storage.s3 && typeof storage.s3 === "object") {
      const s3 = storage.s3 as Record<string, unknown>
      if (s3.secretAccessKey === REDACTED_SENTINEL) {
        s3.secretAccessKey = current.storage.s3.secretAccessKey
      }
    }
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
    rows.map((row) => row.id)
  )

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    storageUsedBytes: usage.get(row.id) ?? 0,
  }))
}

export function hasEnabledSignInMethod(config: {
  passkeyEnabled: boolean
  oauthProvider: { enabled: boolean } | null
}): boolean {
  void config.oauthProvider
  return config.passkeyEnabled
}

function sanitizeScopes(scopes: string[] | undefined): string[] | undefined {
  const next = scopes?.map((scope) => scope.trim()).filter(Boolean)
  return next && next.length > 0 ? next : undefined
}

export function finalizeOAuthProviderSubmission(
  provider: OAuthProviderAdminSubmission,
  existing: OAuthProviderConfig | null
): OAuthProviderConfig {
  const parsedProvider = OAuthProviderSubmissionSchema.parse({
    ...provider,
    clientId:
      typeof provider.clientId === "string"
        ? provider.clientId.trim()
        : provider.clientId,
    clientSecret:
      typeof provider.clientSecret === "string"
        ? provider.clientSecret.trim()
        : provider.clientSecret,
    scopes: sanitizeScopes(
      Array.isArray(provider.scopes)
        ? provider.scopes.filter(
            (scope): scope is string => typeof scope === "string"
          )
        : undefined
    ),
  })
  const clientSecret =
    parsedProvider.clientSecret.length > 0
      ? parsedProvider.clientSecret
      : existing?.providerId === parsedProvider.providerId
        ? existing.clientSecret
        : ""
  if (clientSecret.length === 0) {
    throw new Error(
      `Client secret is required for ${parsedProvider.displayName}.`
    )
  }
  return OAuthProviderSchema.parse({
    ...parsedProvider,
    clientSecret,
  }) as OAuthProviderConfig
}

export function patchRuntimeConfig(patch: Partial<RuntimeConfig>): void {
  configStore.patch(patch)
}

type StorageConfigPatch = {
  driver?: StorageConfig["driver"]
  fs?: Partial<StorageConfig["fs"]>
  s3?: Partial<Omit<StorageConfig["s3"], "endpoint" | "accessKeyId" | "secretAccessKey">> & {
    endpoint?: string | null
    accessKeyId?: string | null
    secretAccessKey?: string | null
  }
}

export function mergeStorageConfigPatch(
  current: StorageConfig,
  patch: StorageConfigPatch
): StorageConfig {
  const next = structuredClone(current)
  next.driver = patch.driver ?? current.driver
  next.fs = { ...current.fs, ...patch.fs }

  if (patch.s3?.bucket !== undefined) next.s3.bucket = patch.s3.bucket
  if (patch.s3?.region !== undefined) next.s3.region = patch.s3.region
  if (patch.s3?.forcePathStyle !== undefined) {
    next.s3.forcePathStyle = patch.s3.forcePathStyle
  }
  if (patch.s3?.presignExpiresSec !== undefined) {
    next.s3.presignExpiresSec = patch.s3.presignExpiresSec
  }

  if (patch.s3?.endpoint === null) {
    delete next.s3.endpoint
  } else if (patch.s3?.endpoint !== undefined) {
    next.s3.endpoint = patch.s3.endpoint
  }
  if (patch.s3?.accessKeyId === null) {
    delete next.s3.accessKeyId
  } else if (patch.s3?.accessKeyId !== undefined) {
    next.s3.accessKeyId = patch.s3.accessKeyId
  }
  if (
    patch.fs?.hmacSecret === undefined ||
    patch.fs.hmacSecret === REDACTED_SENTINEL
  ) {
    next.fs.hmacSecret = current.fs.hmacSecret
  }
  if (
    patch.s3?.secretAccessKey === undefined ||
    patch.s3.secretAccessKey === REDACTED_SENTINEL
  ) {
    next.s3.secretAccessKey = current.s3.secretAccessKey
  } else if (patch.s3?.secretAccessKey === null) {
    delete next.s3.secretAccessKey
  }

  return next
}
