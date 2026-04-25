import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth"
import type { PublicAuthProvider } from "@workspace/contracts"
import { and, eq, inArray } from "drizzle-orm"

import { account, user } from "@workspace/db/auth-schema"
import { db } from "../db"
import { configStore, type OAuthProviderConfig } from "./config-store"

const GIB = 1024 * 1024 * 1024

export function getEnabledProviderConfig(): OAuthProviderConfig | null {
  const provider = configStore.get("oauthProvider")
  return provider && provider.enabled ? provider : null
}

function isImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function imageFromProfile(
  profile: Record<string, unknown>
): string | undefined {
  for (const key of ["picture", "image", "avatar_url"] as const) {
    const candidate = profile[key]
    if (isImageUrl(candidate)) return candidate
  }
  return undefined
}

function quotaBytesFromClaimValue(value: unknown): number | null | undefined {
  if (value === null) return null

  const gib =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN

  if (!Number.isFinite(gib) || gib < 0) return undefined

  const bytes = Math.round(gib * GIB)
  return bytes <= Number.MAX_SAFE_INTEGER ? bytes : undefined
}

function quotaBytesFromProfile(
  profile: Record<string, unknown>,
  claim: string | undefined
): number | null | undefined {
  if (!claim) return undefined
  if (!(claim in profile)) return null
  return quotaBytesFromClaimValue(profile[claim])
}

async function updateExistingOAuthUserQuota(
  providerId: string,
  profile: Record<string, unknown>,
  storageQuotaBytes: number | null | undefined
): Promise<void> {
  if (storageQuotaBytes === undefined) return

  const accountId = typeof profile.id === "string" ? profile.id : null
  const email =
    typeof profile.email === "string" ? profile.email.toLowerCase() : null
  if (!accountId && !email) return

  try {
    const targetIds = new Set<string>()
    if (accountId) {
      const rows = await db
        .select({ userId: account.userId })
        .from(account)
        .where(
          and(
            eq(account.providerId, providerId),
            eq(account.accountId, accountId)
          )
        )
        .limit(1)
      if (rows[0]) targetIds.add(rows[0].userId)
    }
    if (email) {
      const rows = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1)
      if (rows[0]) targetIds.add(rows[0].id)
    }
    if (targetIds.size === 0) return

    await db
      .update(user)
      .set({ storageQuotaBytes, updatedAt: new Date() })
      .where(inArray(user.id, [...targetIds]))
  } catch {
    // Quota sync is best-effort; auth should not fail if this side update does.
  }
}

export function buildGenericOAuthConfig(): GenericOAuthConfig[] {
  const provider = getEnabledProviderConfig()
  if (!provider) return []
  const { openRegistrations } = configStore.getAll()
  const claim = provider.usernameClaim ?? "preferred_username"
  return [
    {
      providerId: provider.providerId,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      scopes: provider.scopes,
      discoveryUrl: provider.discoveryUrl,
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      userInfoUrl: provider.userInfoUrl,
      pkce: provider.pkce,
      disableSignUp: !openRegistrations,
      mapProfileToUser: async (profile) => {
        const rawProfile = profile as Record<string, unknown>
        const next: {
          name?: string
          image?: string
          storageQuotaBytes?: number | null
        } = {}
        const rawName = rawProfile[claim]
        if (typeof rawName === "string" && rawName.length > 0) {
          next.name = rawName
        }
        const image = imageFromProfile(rawProfile)
        if (image) next.image = image
        const storageQuotaBytes = quotaBytesFromProfile(
          rawProfile,
          provider.quotaClaim
        )
        if (storageQuotaBytes !== undefined) {
          next.storageQuotaBytes = storageQuotaBytes
          await updateExistingOAuthUserQuota(
            provider.providerId,
            rawProfile,
            storageQuotaBytes
          )
        }
        return next
      },
    } satisfies GenericOAuthConfig,
  ]
}

export function buildTrustedProviders(): string[] {
  const provider = getEnabledProviderConfig()
  return provider ? [provider.providerId] : []
}

export function getPublicProvider(): PublicAuthProvider | null {
  const provider = getEnabledProviderConfig()
  return provider
    ? {
        providerId: provider.providerId,
        displayName: provider.displayName,
      }
    : null
}
