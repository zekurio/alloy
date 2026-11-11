import {
  OIDC_PROVIDER_ID,
  type OidcConfig,
  type UserRole,
} from "@alloy/contracts"
import { authAccount, user, userPasskey } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { and, eq, ne, sql } from "drizzle-orm"

import {
  assertCanRemoveAdminInTransaction,
  withAdminAccessInvariant,
} from "./identity"
import { syncOAuthAvatar } from "./oauth-avatar"
import { defaultOAuthStorageQuota } from "./oauth-profile"
import type { OAuthProfile } from "./oauth-types"
import { oidcManagesUsernames } from "./oidc-managed-profile"
import { createFirstAdmin } from "./setup"
import {
  findUserIdByUsernameHint,
  generateUniqueUsername,
  usernameFromHint,
} from "./username"

const logger = createLogger("oauth")
const NO_LINKED_ACCOUNT =
  "No Alloy account is linked to this OAuth account. Sign in with another method and link it from settings."

export type SignInResolution = {
  /**
   * `claimed`: the username claim named a user with no sign-in method, who is
   * now linked. `link-required`: it named a user who can sign in, and has to
   * before linking.
   */
  kind: "matched" | "created" | "claimed" | "link-required"
  userId: string
}

type OAuthIdentity = {
  profile: OAuthProfile
  provider: OidcConfig
}

export async function resolveSignInUser(
  input: OAuthIdentity,
): Promise<SignInResolution> {
  const existingAccount = await findLinkedAccount(
    input.profile.providerAccountId,
  )
  if (existingAccount) {
    await updateLinkedAccount(existingAccount.id, input.profile)
    await syncOAuthUserRole(existingAccount.user_id, input.profile)
    await syncOAuthProfile(existingAccount.user_id, input.profile)
    return { kind: "matched", userId: existingAccount.user_id }
  }

  const match = await findUserIdByUsernameHint(input.profile.usernameHint)
  if (match) {
    // Linking on the claim alone would hand the local account to whoever
    // controls that claim at the provider, so the user proves they own it by
    // signing in first. A user with no sign-in method has nothing to prove
    // it with: an admin created it for the person the provider gives that
    // username to.
    const claimed = await claimUserWithoutSignInMethod(match, input.profile)
    return { kind: claimed ? "claimed" : "link-required", userId: match }
  }

  return { kind: "created", userId: await createUserForOAuthAccount(input) }
}

/** Create a user for an OAuth identity that no user is linked to yet. */
export async function createUserForOAuthAccount(
  input: OAuthIdentity,
): Promise<string> {
  if (!input.provider.allowSignUp) throw new Error(NO_LINKED_ACCOUNT)

  const userId = await db.transaction(async (tx) => {
    const row = await createOAuthUser(input.profile, async (values) => {
      const [inserted] = await tx.insert(user).values(values).returning()
      if (!inserted) throw new Error("Could not create user.")
      return inserted
    })

    const [linked] = await tx
      .insert(authAccount)
      .values(accountValues(row.id, input.profile))
      .onConflictDoNothing()
      .returning({ id: authAccount.id })

    if (!linked) {
      const account = await findLinkedAccount(input.profile.providerAccountId)
      if (!account) throw new Error("Could not link OAuth account.")
      if (account.user_id !== row.id) {
        throw new Error("OAuth account is already linked to another user.")
      }
      await updateLinkedAccount(account.id, input.profile)
    }

    return row.id
  })

  await syncOAuthUserRole(userId, input.profile)
  await syncOAuthAvatar(userId, input.profile)
  return userId
}

/**
 * Create the first admin for an OIDC identity and finish setup. The caller
 * checked that the provider's role claim marks it as an admin. Sign-up being
 * off does not apply.
 */
export async function createFirstAdminForOAuthAccount(
  profile: OAuthProfile,
): Promise<string> {
  const userId = await createFirstAdmin(async (tx) => {
    const row = await createOAuthUser(
      profile,
      async (values) => {
        const [inserted] = await tx.insert(user).values(values).returning()
        if (!inserted) throw new Error("Could not create user.")
        return inserted
      },
      "admin",
    )
    const [linked] = await tx
      .insert(authAccount)
      .values(accountValues(row.id, profile))
      .onConflictDoNothing()
      .returning({ id: authAccount.id })
    if (!linked) {
      throw new Error("OAuth account is already linked to another user.")
    }
    return row.id
  })
  await syncOAuthAvatar(userId, profile)
  return userId
}

/**
 * Link the identity to a user who has no passkey and no linked account.
 * False when the user has a sign-in method, or got one in the meantime.
 */
async function claimUserWithoutSignInMethod(
  userId: string,
  profile: OAuthProfile,
): Promise<boolean> {
  const claimed = await db.transaction(async (tx) => {
    // Locks out a second identity claiming the same user.
    const [row] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .for("update")
    if (!row) return false
    const [passkey] = await tx
      .select({ id: userPasskey.id })
      .from(userPasskey)
      .where(eq(userPasskey.user_id, userId))
      .limit(1)
    const [account] = await tx
      .select({ id: authAccount.id })
      .from(authAccount)
      .where(eq(authAccount.user_id, userId))
      .limit(1)
    if (passkey || account) return false
    await tx.insert(authAccount).values(accountValues(userId, profile))
    return true
  })
  if (!claimed) return false
  await syncOAuthUserRole(userId, profile)
  await syncOAuthProfile(userId, profile)
  return true
}

export async function linkAccountToUser(input: {
  profile: OAuthProfile
  userId: string
}): Promise<void> {
  const existing = await findLinkedAccount(input.profile.providerAccountId)
  if (existing && existing.user_id !== input.userId) {
    throw new Error("OAuth account is already linked to another user.")
  }
  if (existing) {
    await updateLinkedAccount(existing.id, input.profile)
    await syncOAuthProfile(input.userId, input.profile)
    return
  }

  await db
    .insert(authAccount)
    .values(accountValues(input.userId, input.profile))
  await syncOAuthUserRole(input.userId, input.profile)
  await syncOAuthProfile(input.userId, input.profile)
}

export function listLinkedAccounts(userId: string) {
  return db
    .select({
      id: authAccount.id,
      accountId: authAccount.provider_account_id,
      accountLabel: authAccount.account_label,
      createdAt: authAccount.created_at,
    })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.user_id, userId),
        eq(authAccount.provider_id, OIDC_PROVIDER_ID),
      ),
    )
    .orderBy(authAccount.created_at)
}

async function findLinkedAccount(providerAccountId: string) {
  const [account] = await db
    .select()
    .from(authAccount)
    .where(
      and(
        eq(authAccount.provider_id, OIDC_PROVIDER_ID),
        eq(authAccount.provider_account_id, providerAccountId),
      ),
    )
    .limit(1)
  return account ?? null
}

async function updateLinkedAccount(
  accountId: string,
  profile: OAuthProfile,
): Promise<void> {
  await db
    .update(authAccount)
    .set({
      account_label: profile.usernameHint,
      updated_at: new Date(),
    })
    .where(eq(authAccount.id, accountId))
}

/**
 * Copy the provider's profile over on every sign-in and link: the username
 * while the provider manages usernames, and the avatar for a user who has
 * none yet.
 */
async function syncOAuthProfile(
  userId: string,
  profile: OAuthProfile,
): Promise<void> {
  if (oidcManagesUsernames()) await syncOAuthUsername(userId, profile)
  await syncOAuthAvatar(userId, profile)
}

async function syncOAuthUsername(
  userId: string,
  profile: OAuthProfile,
): Promise<void> {
  const username = usernameFromHint(profile.usernameHint)
  if (!username) return
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ username: user.username })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
        .for("update")
      if (!current || current.username === username) return

      // Another user keeps a name they already hold, so a clash leaves the
      // current username in place until a later sign-in finds it free.
      const [taken] = await tx
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            eq(sql`lower(${user.username})`, username.toLowerCase()),
            ne(user.id, userId),
          ),
        )
        .limit(1)
      if (taken) {
        logger.warn(
          `kept username of user ${userId}: OIDC username "${username}" is taken`,
        )
        return
      }

      await tx
        .update(user)
        .set({ username, updated_at: new Date() })
        .where(eq(user.id, userId))
    })
  } catch (cause) {
    logger.warn(`username sync failed for user ${userId}:`, cause)
  }
}

async function syncOAuthUserRole(
  userId: string,
  profile: OAuthProfile,
): Promise<void> {
  if (profile.role === undefined) return
  const result = await withAdminAccessInvariant(async (tx) => {
    const [current] = await tx
      .select({ role: user.role, status: user.status })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .for("update")
    if (!current || current.role === profile.role) return null

    if (
      current.role === "admin" &&
      current.status === "active" &&
      profile.role !== "admin"
    ) {
      try {
        await assertCanRemoveAdminInTransaction(tx, userId)
      } catch (cause) {
        return { skipped: cause }
      }
    }

    await tx
      .update(user)
      .set({ role: profile.role, updated_at: new Date() })
      .where(eq(user.id, userId))
    return null
  })
  if (result?.skipped) {
    logger.warn("skipped OAuth role demotion:", result.skipped)
  }
}

async function createOAuthUser(
  profile: OAuthProfile,
  insert: (
    values: typeof user.$inferInsert,
  ) => Promise<typeof user.$inferSelect>,
  role: UserRole = profile.role ?? "user",
) {
  const username = await generateUniqueUsername({ name: profile.usernameHint })
  return insert({
    username,
    role,
    storage_quota_bytes:
      profile.storageQuotaBytes === undefined
        ? defaultOAuthStorageQuota()
        : profile.storageQuotaBytes,
  })
}

function accountValues(
  userId: string,
  profile: OAuthProfile,
): typeof authAccount.$inferInsert {
  return {
    user_id: userId,
    provider_id: OIDC_PROVIDER_ID,
    provider_account_id: profile.providerAccountId,
    account_label: profile.usernameHint,
  }
}
