import type { OAuthProviderConfig } from "@alloy/contracts"
import { authAccount, user } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { and, eq } from "drizzle-orm"

import { assertCanRemoveAdmin, findUserByEmail } from "./identity"
import { syncOAuthAvatar } from "./oauth-avatar"
import { defaultOAuthStorageQuota } from "./oauth-profile"
import type { OAuthProfile, StoredTokens } from "./oauth-types"
import { generateUniqueUsername, slugifyUsername } from "./username"

const logger = createLogger("oauth")

export async function resolveSignInUser(input: {
  profile: OAuthProfile
  provider: OAuthProviderConfig
  tokens: StoredTokens
}): Promise<{ userId: string; created: boolean }> {
  const existingAccount = await findLinkedAccount(
    input.provider.providerId,
    input.profile.providerAccountId,
  )
  if (existingAccount) {
    await updateLinkedAccount(existingAccount.id, input.profile, input.tokens)
    await syncOAuthUserRole(existingAccount.user_id, input.profile)
    return { userId: existingAccount.user_id, created: false }
  }

  if (!input.profile.email) {
    throw new Error("OAuth profile is missing an email address.")
  }

  const existingUser = await findUserByEmail(input.profile.email)
  if (existingUser && !input.profile.emailVerified) {
    throw new Error(
      "An account already exists for that email. Sign in and link this provider from settings.",
    )
  }
  if (!existingUser && !configStore.get("openRegistrations")) {
    throw new Error(
      "No Alloy account is linked to this OAuth account. Sign in with another method and link it from settings.",
    )
  }
  const created = !existingUser

  const userId = await db.transaction(async (tx) => {
    const row =
      existingUser ??
      (await createOAuthUser(input.profile, async (values) => {
        const [inserted] = await tx.insert(user).values(values).returning()
        if (!inserted) throw new Error("Could not create user.")
        return inserted
      }))

    const [linked] = await tx
      .insert(authAccount)
      .values(
        accountValues(
          row.id,
          input.provider.providerId,
          input.profile,
          input.tokens,
        ),
      )
      .onConflictDoNothing()
      .returning({ id: authAccount.id })

    if (!linked) {
      const account = await findLinkedAccount(
        input.provider.providerId,
        input.profile.providerAccountId,
      )
      if (!account) throw new Error("Could not link OAuth account.")
      if (account.user_id !== row.id) {
        throw new Error("OAuth account is already linked to another user.")
      }
      await updateLinkedAccount(account.id, input.profile, input.tokens)
    }

    return row.id
  })

  await syncOAuthUserRole(userId, input.profile)
  await syncOAuthAvatar(userId, input.profile)
  return { userId, created }
}

export async function linkAccountToUser(input: {
  profile: OAuthProfile
  provider: OAuthProviderConfig
  tokens: StoredTokens
  userId: string
}): Promise<void> {
  const existing = await findLinkedAccount(
    input.provider.providerId,
    input.profile.providerAccountId,
  )
  if (existing && existing.user_id !== input.userId) {
    throw new Error("OAuth account is already linked to another user.")
  }
  if (existing) {
    await updateLinkedAccount(existing.id, input.profile, input.tokens)
    await syncOAuthAvatar(input.userId, input.profile)
    return
  }

  await db
    .insert(authAccount)
    .values(
      accountValues(
        input.userId,
        input.provider.providerId,
        input.profile,
        input.tokens,
      ),
    )
  await syncOAuthUserRole(input.userId, input.profile)
  await syncOAuthAvatar(input.userId, input.profile)
}

async function findLinkedAccount(
  providerId: string,
  providerAccountId: string,
) {
  const [account] = await db
    .select()
    .from(authAccount)
    .where(
      and(
        eq(authAccount.provider_id, providerId),
        eq(authAccount.provider_account_id, providerAccountId),
      ),
    )
    .limit(1)
  return account ?? null
}

async function updateLinkedAccount(
  accountId: string,
  profile: OAuthProfile,
  tokens: StoredTokens,
): Promise<void> {
  await db
    .update(authAccount)
    .set({
      email: profile.email,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      id_token: tokens.idToken,
      access_token_expires_at: tokens.accessTokenExpiresAt,
      scope: tokens.scope,
      updated_at: new Date(),
    })
    .where(eq(authAccount.id, accountId))
}

async function syncOAuthUserRole(
  userId: string,
  profile: OAuthProfile,
): Promise<void> {
  if (profile.role === undefined) return

  const [current] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!current || current.role === profile.role) return

  if (profile.role !== "admin") {
    try {
      await assertCanRemoveAdmin(userId)
    } catch (cause) {
      logger.warn("skipped OAuth role demotion:", cause)
      return
    }
  }

  await db
    .update(user)
    .set({ role: profile.role, updated_at: new Date() })
    .where(eq(user.id, userId))
}

async function createOAuthUser(
  profile: OAuthProfile,
  insert: (
    values: typeof user.$inferInsert,
  ) => Promise<typeof user.$inferSelect>,
) {
  if (!profile.email) {
    throw new Error("OAuth profile is missing an email address.")
  }
  const username = await generateUniqueUsername({
    email: profile.email,
    name: profile.usernameHint
      ? slugifyUsername(profile.usernameHint)
      : profile.email,
  })
  return insert({
    email: profile.email,
    email_verified: profile.emailVerified,
    username,
    role: profile.role ?? "user",
    storage_quota_bytes:
      profile.storageQuotaBytes === undefined
        ? defaultOAuthStorageQuota()
        : profile.storageQuotaBytes,
  })
}

function accountValues(
  userId: string,
  providerId: string,
  profile: OAuthProfile,
  tokens: StoredTokens,
): typeof authAccount.$inferInsert {
  return {
    user_id: userId,
    provider_id: providerId,
    provider_account_id: profile.providerAccountId,
    email: profile.email,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    id_token: tokens.idToken,
    access_token_expires_at: tokens.accessTokenExpiresAt,
    scope: tokens.scope,
  }
}
