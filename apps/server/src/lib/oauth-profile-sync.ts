import { decryptOAuthToken } from "better-auth/oauth2"
import { and, eq } from "drizzle-orm"

import { account, user } from "@workspace/db/auth-schema"

import { getAuth } from "../auth"
import { db } from "../db"
import {
  getEnabledProviderConfig,
  imageFromProfile,
} from "./oauth-config"

type DecryptContext = Parameters<typeof decryptOAuthToken>[1]
type LinkedAccountTokens = {
  accessToken: string | null
  idToken: string | null
}

type OAuthProfileSyncResult = {
  image: string | null
  synced: boolean
}

function getDecryptContextPromise(): Promise<DecryptContext> {
  const auth = getAuth() as ReturnType<typeof getAuth> & {
    $context: Promise<DecryptContext>
  }
  return auth.$context
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".")
  if (!payload) return null

  try {
    const json = Buffer.from(payload, "base64url").toString("utf8")
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

async function resolveUserInfoUrl(): Promise<string | null> {
  const provider = getEnabledProviderConfig()
  if (!provider) return null
  if (provider.userInfoUrl) return provider.userInfoUrl
  if (!provider.discoveryUrl) return null

  try {
    const res = await fetch(provider.discoveryUrl, {
      headers: { accept: "application/json" },
    })
    if (!res.ok) return null
    const parsed = (await res.json()) as unknown
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "userinfo_endpoint" in parsed &&
      typeof parsed.userinfo_endpoint === "string"
    ) {
      return parsed.userinfo_endpoint
    }
  } catch {
    return null
  }

  return null
}

async function fetchOAuthProfile(
  tokens: LinkedAccountTokens
): Promise<Record<string, unknown> | null> {
  if (tokens.idToken) {
    const decoded = decodeJwtPayload(tokens.idToken)
    if (decoded?.sub && decoded.email) return decoded
  }

  if (!tokens.accessToken) return null

  const context = await getDecryptContextPromise()
  const accessToken = await decryptOAuthToken(tokens.accessToken, context)
  if (!accessToken) return null

  const userInfoUrl = await resolveUserInfoUrl()
  if (!userInfoUrl) return null

  try {
    const res = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null

    const parsed = (await res.json()) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function syncLinkedOAuthImage(
  userId: string
): Promise<OAuthProfileSyncResult> {
  const provider = getEnabledProviderConfig()
  if (!provider) return { image: null, synced: false }

  const [linkedAccount] = await db
    .select({
      accessToken: account.accessToken,
      idToken: account.idToken,
    })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, provider.providerId)
      )
    )
    .limit(1)

  if (!linkedAccount) return { image: null, synced: false }

  const profile = await fetchOAuthProfile(linkedAccount)
  if (!profile) return { image: null, synced: false }

  const image = imageFromProfile(profile)
  if (!image) return { image: null, synced: false }

  const [updated] = await db
    .update(user)
    .set({ image })
    .where(eq(user.id, userId))
    .returning({ image: user.image })

  return { image: updated?.image ?? image, synced: true }
}
