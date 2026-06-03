import { desc, inArray } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"

import { db } from "../db"
import { env } from "../env"
import {
  type OAuthProviderConfig,
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
  type RuntimeConfig,
} from "../config/store"
import { isoDate } from "../runtime/date"
import { selectSourceStorageUsedBytesByUserIds } from "../storage/quota"

export const REDACTED_SENTINEL = "***"

type OAuthProviderAdminSubmission = Record<string, unknown> & {
  providerId?: string
}

function redactSecrets(
  config: Readonly<RuntimeConfig>,
): Readonly<RuntimeConfig> {
  return {
    ...config,
    integrations: {
      ...config.integrations,
      steamgriddbApiKey: config.integrations.steamgriddbApiKey
        ? REDACTED_SENTINEL
        : "",
    },
    secrets: {
      ...config.secrets,
      viewerCookieSecret: config.secrets.viewerCookieSecret
        ? REDACTED_SENTINEL
        : "",
      uploadHmacSecret: config.secrets.uploadHmacSecret
        ? REDACTED_SENTINEL
        : "",
    },
    oauthProviders: config.oauthProviders.map((provider) => ({
      ...provider,
      clientSecret: "",
    })),
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
  current: RuntimeConfig,
): void {
  if (input.integrations && typeof input.integrations === "object") {
    const integrations = input.integrations as Record<string, unknown>
    if (integrations.steamgriddbApiKey === REDACTED_SENTINEL) {
      integrations.steamgriddbApiKey = current.integrations.steamgriddbApiKey
    }
  }
  if (input.secrets && typeof input.secrets === "object") {
    const secrets = input.secrets as Record<string, unknown>
    if (secrets.viewerCookieSecret === REDACTED_SENTINEL) {
      secrets.viewerCookieSecret = current.secrets.viewerCookieSecret
    }
    if (secrets.uploadHmacSecret === REDACTED_SENTINEL) {
      secrets.uploadHmacSecret = current.secrets.uploadHmacSecret
    }
  }
  if (Array.isArray(input.oauthProviders)) {
    const currentById = new Map(
      current.oauthProviders.map((provider) => [provider.providerId, provider]),
    )
    for (const provider of input.oauthProviders) {
      if (
        !provider || typeof provider !== "object" || Array.isArray(provider)
      ) {
        continue
      }
      const row = provider as Record<string, unknown>
      const providerId = typeof row.providerId === "string"
        ? row.providerId
        : ""
      if (!row.clientSecret || row.clientSecret === "") {
        row.clientSecret = currentById.get(providerId)?.clientSecret ?? ""
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

export function finalizeOAuthProviderSubmission(
  provider: OAuthProviderAdminSubmission,
  existingProviders: OAuthProviderConfig[],
): OAuthProviderConfig {
  const parsedProvider = OAuthProviderSubmissionSchema.parse(
    normalizeOAuthProviderSubmission(provider),
  )
  const existing = existingProviders.find((candidate) =>
    candidate.providerId === parsedProvider.providerId
  )
  const clientSecret = parsedProvider.clientSecret.length > 0
    ? parsedProvider.clientSecret
    : existing
    ? existing.clientSecret
    : ""
  if (clientSecret.length === 0) {
    throw new Error(
      `Client secret is required for ${parsedProvider.displayName}.`,
    )
  }
  return OAuthProviderSchema.parse({
    ...parsedProvider,
    clientSecret,
  }) as OAuthProviderConfig
}
