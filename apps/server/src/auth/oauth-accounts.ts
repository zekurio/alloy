import { and, eq } from "drizzle-orm"

import { authAccount, user } from "@workspace/db/auth-schema"

import { configStore, type OAuthProviderConfig } from "../config/store"
import { db } from "../db"
import { assertCanRemoveAdmin, findUserByEmail } from "./identity"
import type { OAuthProfile, StoredTokens } from "./oauth-types"
import { defaultOAuthStorageQuota } from "./oauth-profile"
import { generateUniqueUsername, slugifyUsername } from "./username"

export async function resolveSignInUser(input: {
  profile: OAuthProfile
  provider: OAuthProviderConfig
  tokens: StoredTokens
}): Promise<string> {
  const existingAccount = await findLinkedAccount(
    input.provider.providerId,
    input.profile.providerAccountId
  )
  if (existingAccount) {
    await updateLinkedAccount(existingAccount.id, input.profile, input.tokens)
    await syncOAuthUserRole(existingAccount.userId, input.profile)
    return existingAccount.userId
  }

  if (!input.profile.email) {
    throw new Error("OAuth profile is missing an email address.")
  }

  const existingUser = await findUserByEmail(input.profile.email)
  if (existingUser && !input.profile.emailVerified) {
    throw new Error(
      "An account already exists for that email. Sign in and link this provider from settings."
    )
  }
  if (!existingUser && !configStore.get("openRegistrations")) {
    throw new Error("Sign-up is currently closed.")
  }

  const userId = await db.transaction(async (tx) => {
    const row =
      existingUser ??
      (await createOAuthUser(input.profile, async (values) => {
        const [created] = await tx.insert(user).values(values).returning()
        if (!created) throw new Error("Could not create user.")
        return created
      }))

    const [linked] = await tx
      .insert(authAccount)
      .values(
        accountValues(
          row.id,
          input.provider.providerId,
          input.profile,
          input.tokens
        )
      )
      .onConflictDoNothing()
      .returning({ id: authAccount.id })

    if (!linked) {
      const account = await findLinkedAccount(
        input.provider.providerId,
        input.profile.providerAccountId
      )
      if (!account) throw new Error("Could not link OAuth account.")
      if (account.userId !== row.id) {
        throw new Error("OAuth account is already linked to another user.")
      }
      await updateLinkedAccount(account.id, input.profile, input.tokens)
    }

    return row.id
  })

  await syncOAuthUserRole(userId, input.profile)
  return userId
}

export async function linkAccountToUser(input: {
  profile: OAuthProfile
  provider: OAuthProviderConfig
  tokens: StoredTokens
  userId: string
}): Promise<void> {
  const existing = await findLinkedAccount(
    input.provider.providerId,
    input.profile.providerAccountId
  )
  if (existing && existing.userId !== input.userId) {
    throw new Error("OAuth account is already linked to another user.")
  }
  if (existing) {
    await updateLinkedAccount(existing.id, input.profile, input.tokens)
    return
  }

  await db
    .insert(authAccount)
    .values(
      accountValues(
        input.userId,
        input.provider.providerId,
        input.profile,
        input.tokens
      )
    )
  if (input.profile.picture) {
    await db
      .update(user)
      .set({ image: input.profile.picture, updatedAt: new Date() })
      .where(eq(user.id, input.userId))
  }
  await syncOAuthUserRole(input.userId, input.profile)
}

async function findLinkedAccount(
  providerId: string,
  providerAccountId: string
) {
  const [account] = await db
    .select()
    .from(authAccount)
    .where(
      and(
        eq(authAccount.providerId, providerId),
        eq(authAccount.providerAccountId, providerAccountId)
      )
    )
    .limit(1)
  return account ?? null
}

async function updateLinkedAccount(
  accountId: string,
  profile: OAuthProfile,
  tokens: StoredTokens
): Promise<void> {
  await db
    .update(authAccount)
    .set({
      email: profile.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      scope: tokens.scope,
      updatedAt: new Date(),
    })
    .where(eq(authAccount.id, accountId))
}

async function syncOAuthUserRole(
  userId: string,
  profile: OAuthProfile
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
      console.warn("[auth/oauth] skipped OAuth role demotion:", cause)
      return
    }
  }

  await db
    .update(user)
    .set({ role: profile.role, updatedAt: new Date() })
    .where(eq(user.id, userId))
}

async function createOAuthUser(
  profile: OAuthProfile,
  insert: (
    values: typeof user.$inferInsert
  ) => Promise<typeof user.$inferSelect>
) {
  if (!profile.email) {
    throw new Error("OAuth profile is missing an email address.")
  }
  const username = await generateUniqueUsername({
    email: profile.email,
    name: profile.usernameHint
      ? slugifyUsername(profile.usernameHint)
      : profile.name,
  })
  return insert({
    email: profile.email,
    emailVerified: profile.emailVerified,
    username,
    name: profile.name,
    image: profile.picture,
    role: profile.role ?? "user",
    storageQuotaBytes:
      profile.storageQuotaBytes === undefined
        ? defaultOAuthStorageQuota()
        : profile.storageQuotaBytes,
  })
}

function accountValues(
  userId: string,
  providerId: string,
  profile: OAuthProfile,
  tokens: StoredTokens
): typeof authAccount.$inferInsert {
  return {
    userId,
    providerId,
    providerAccountId: profile.providerAccountId,
    email: profile.email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    scope: tokens.scope,
  }
}
