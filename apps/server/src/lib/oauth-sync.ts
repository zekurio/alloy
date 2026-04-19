import { and, eq } from "drizzle-orm"

import { account, user } from "@workspace/db/auth-schema"

import { db } from "../db"
import { configStore } from "./config-store"

/**
 * Pulls the current userinfo from the configured OAuth provider and writes
 * the avatar back onto the local `user.image` column.
 *
 * Better-auth's generic-oauth plugin only copies `picture -> image` when it
 * *creates* a user; when an OAuth identity later links onto a pre-existing
 * credential account the avatar stays whatever the user first set. This
 * helper closes that gap — it's invoked both from the manual "sync" button
 * on the profile page and (opportunistically) from a session-create hook so
 * that the image gets populated on first OAuth sign-in without clobbering
 * anything the user set by hand.
 */

type UserInfoResponse = Record<string, unknown>

export type SyncStatus =
  | "ok" // Image was updated (or confirmed unchanged) successfully.
  | "no-oauth-provider" // No OAuth provider is configured globally.
  | "no-linked-account" // User has no account row for the provider.
  | "no-access-token" // Account row exists but we lack a usable token.
  | "no-userinfo-url" // Couldn't resolve a userinfo endpoint.
  | "no-image-in-response" // Provider returned no picture/avatar claim.
  | "fetch-failed" // Network/HTTP error talking to the provider.

export interface SyncResult {
  status: SyncStatus
  image: string | null
  message?: string
}

const IMAGE_CLAIMS = ["picture", "image", "avatar_url", "avatar"] as const

function pickImage(data: UserInfoResponse): string | null {
  for (const key of IMAGE_CLAIMS) {
    const value = data[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return null
}

/**
 * Discovery documents advertise the userinfo endpoint under
 * `userinfo_endpoint`. For providers without discovery we fall back to the
 * explicit URL in the runtime config.
 */
async function resolveUserInfoUrl(): Promise<string | null> {
  const provider = configStore.get("oauthProvider")
  if (!provider) return null
  if (provider.userInfoUrl) return provider.userInfoUrl
  if (provider.discoveryUrl) {
    try {
      const res = await fetch(provider.discoveryUrl)
      if (!res.ok) return null
      const doc = (await res.json()) as { userinfo_endpoint?: string }
      return doc.userinfo_endpoint ?? null
    } catch {
      return null
    }
  }
  return null
}

export async function syncOAuthImage(
  userId: string,
  opts: { overwrite?: boolean } = {}
): Promise<SyncResult> {
  const provider = configStore.get("oauthProvider")
  if (!provider) {
    return { status: "no-oauth-provider", image: null }
  }

  const [oauthAccount] = await db
    .select()
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, provider.providerId)
      )
    )
    .limit(1)
  if (!oauthAccount) return { status: "no-linked-account", image: null }
  if (!oauthAccount.accessToken) {
    return { status: "no-access-token", image: null }
  }

  const userInfoUrl = await resolveUserInfoUrl()
  if (!userInfoUrl) return { status: "no-userinfo-url", image: null }

  let data: UserInfoResponse
  try {
    const res = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${oauthAccount.accessToken}` },
    })
    if (!res.ok) {
      return {
        status: "fetch-failed",
        image: null,
        message: `${res.status} ${res.statusText}`,
      }
    }
    data = (await res.json()) as UserInfoResponse
  } catch (cause) {
    return {
      status: "fetch-failed",
      image: null,
      message: cause instanceof Error ? cause.message : "network error",
    }
  }

  const image = pickImage(data)
  if (!image) return { status: "no-image-in-response", image: null }

  const [existing] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!existing) return { status: "no-linked-account", image: null }

  // Conservative default: only populate a missing avatar. The manual button
  // passes `overwrite: true` to force a refresh even if the user had set
  // something else.
  if (!opts.overwrite && existing.image) {
    return { status: "ok", image: existing.image }
  }

  if (existing.image !== image) {
    await db
      .update(user)
      .set({ image, updatedAt: new Date() })
      .where(eq(user.id, userId))
  }

  return { status: "ok", image }
}
