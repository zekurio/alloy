import { type NewUser, type User, user } from "@alloy/db/auth-schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { and, eq, ne, sql } from "drizzle-orm"

import {
  type AccountDisableSource,
  disabledAccountState,
  selfReactivatedAccountState,
} from "./account-state"
import {
  lockAdminAccessInvariant,
  withAdminAccessInvariant,
} from "./admin-access"
import {
  hasAdminSignInMethodForConfig,
  hasAdminSignInMethodWith,
  usableSignInConfig,
} from "./sign-in-config"
import {
  generateUniqueUsername,
  normalizeDisplayName,
  normalizeUsername,
} from "./username"
export {
  countUserPasskeys,
  deleteUserPasskeyPreservingSignIn,
  unlinkOAuthAccountPreservingSignIn,
  userHasEnabledSignInMethod,
} from "./identity-sign-in-methods"
export { lockAdminAccessInvariant, withAdminAccessInvariant }

export function validateUsername(value: string): string {
  return normalizeUsername(value)
}

export type AuthTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]
type AuthDbExecutor = typeof db | AuthTransaction

async function assertUsernameAvailable(
  executor: AuthDbExecutor,
  username: string,
  excludeUserId?: string,
): Promise<void> {
  const conditions = [eq(sql`lower(${user.username})`, username.toLowerCase())]
  if (excludeUserId) conditions.push(ne(user.id, excludeUserId))
  const [existing] = await executor
    .select({ id: user.id })
    .from(user)
    .where(and(...conditions))
    .limit(1)
  if (existing) throw new Error("Username is already taken.")
}

async function hasAdminSignInMethod(): Promise<boolean> {
  return hasAdminSignInMethodForConfig(currentUsableSignInConfig())
}

export async function setupRequired(): Promise<boolean> {
  return !(await hasAdminSignInMethod())
}

async function hasOtherAdminSignInMethod(
  executor: AuthDbExecutor,
  excludeUserId: string,
): Promise<boolean> {
  return hasAdminSignInMethodWith(executor, currentUsableSignInConfig(), {
    excludeUserId,
  })
}

function currentUsableSignInConfig() {
  return usableSignInConfig({
    passkeyEnabled: configStore.get("passkeyEnabled"),
    oauthProviders: configStore.get("oauthProviders"),
  })
}

export async function assertCanRemoveAdminInTransaction(
  tx: AuthTransaction,
  targetUserId: string,
): Promise<void> {
  const [row] = await tx
    .select({ role: user.role })
    .from(user)
    .where(
      and(
        eq(user.id, targetUserId),
        eq(user.role, "admin"),
        eq(user.status, "active"),
      ),
    )
    .limit(1)
  if (row?.role !== "admin") return
  if (await hasOtherAdminSignInMethod(tx, targetUserId)) return
  throw new Error(
    "Cannot remove the last admin with a sign-in method. Add a sign-in method to another admin first.",
  )
}

export async function disableUserIdentity(
  userId: string,
  source: AccountDisableSource,
): Promise<{ disabledAt: Date } | null> {
  return withAdminAccessInvariant(async (tx) => {
    const [row] = await tx
      .select({
        id: user.id,
        status: user.status,
        disabledAt: user.disabled_at,
        adminSuspendedAt: user.admin_suspended_at,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .for("update")
    if (!row) return null

    if (row.status === "active") {
      await assertCanRemoveAdminInTransaction(tx, userId)
    }
    const now = new Date()
    const next = disabledAccountState(row, source, now)
    await tx
      .update(user)
      .set({
        status: next.status,
        disabled_at: next.disabledAt,
        admin_suspended_at: next.adminSuspendedAt,
        updated_at: now,
      })
      .where(eq(user.id, userId))
    return { disabledAt: next.disabledAt ?? now }
  })
}

export type SelfReactivationResult = "not-found" | "reactivated" | "suspended"

export function reactivateSelfDisabledIdentity(
  userId: string,
): Promise<SelfReactivationResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: user.status,
        disabledAt: user.disabled_at,
        adminSuspendedAt: user.admin_suspended_at,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .for("update")
    if (!row) return "not-found"

    const next = selfReactivatedAccountState(row)
    if (!next) return "suspended"

    await tx
      .update(user)
      .set({
        status: next.status,
        disabled_at: next.disabledAt,
        admin_suspended_at: next.adminSuspendedAt,
        updated_at: new Date(),
      })
      .where(eq(user.id, userId))
    return "reactivated"
  })
}

export async function createUserIdentity(input: {
  username?: string
  role?: "user" | "admin"
}): Promise<User> {
  return createUserIdentityWith(db, input)
}

async function createUserIdentityWith(
  executor: AuthDbExecutor,
  input: {
    username?: string
    role?: "user" | "admin"
  },
): Promise<User> {
  const username = input.username
    ? validateUsername(input.username)
    : await generateUniqueUsername({})
  await assertUsernameAvailable(executor, username)
  const values: NewUser = {
    username,
    role: input.role ?? "user",
    storage_quota_bytes: configStore.get("limits").defaultStorageQuotaBytes,
  }
  const [created] = await executor.insert(user).values(values).returning()
  if (!created) throw new Error("Could not create user.")
  return created
}

export async function createRegistrationUserInTransaction(
  tx: AuthTransaction,
  input: {
    username: string
    setupFirstAdmin: boolean
  },
): Promise<User> {
  const username = validateUsername(input.username)

  if (input.setupFirstAdmin) {
    await lockAdminAccessInvariant(tx)
    if (
      await hasAdminSignInMethodWith(tx, {
        passkeyEnabled: configStore.get("passkeyEnabled"),
        oauthProviders: configStore.get("oauthProviders"),
      })
    ) {
      throw new Error("Initial setup is already complete.")
    }
    // Setup creates a fresh admin because no verified attribute remains to claim.
    return createUserIdentityWith(tx, { username, role: "admin" })
  }

  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-up is currently disabled.")
  }
  if (!configStore.get("openRegistrations")) {
    throw new Error("Sign-up is currently closed.")
  }
  return createUserIdentityWith(tx, { username, role: "user" })
}

export async function updateUserIdentity(
  userId: string,
  input: {
    username?: string
    displayName?: string
    clipAnnouncementsEnabled?: boolean
  },
): Promise<User> {
  const patch: Partial<NewUser> = { updated_at: new Date() }
  if (input.username !== undefined) {
    const username = validateUsername(input.username)
    await assertUsernameAvailable(db, username, userId)
    patch.username = username
  }
  if (input.displayName !== undefined) {
    patch.display_name = normalizeDisplayName(input.displayName)
  }
  if (input.clipAnnouncementsEnabled !== undefined) {
    patch.clip_announcements_enabled = input.clipAnnouncementsEnabled
  }
  const [updated] = await db
    .update(user)
    .set(patch)
    .where(eq(user.id, userId))
    .returning()
  if (!updated) throw new Error("User not found.")
  return updated
}
