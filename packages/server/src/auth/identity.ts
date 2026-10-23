import type { UserRole, UserStatus } from "@alloy/contracts"
import { type NewUser, type User, user } from "@alloy/db/auth-schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, eq, ne, sql } from "drizzle-orm"

import {
  type AccountDisableSource,
  activeAccountState,
  type AccountStateUpdate,
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
  deleteUserPasskeyPreservingSignIn,
  unlinkOAuthAccountPreservingSignIn,
} from "./identity-sign-in-methods"
export { withAdminAccessInvariant }

export function validateUsername(value: string): string {
  return normalizeUsername(value)
}

// users/account-deletion.ts still imports the transaction type under this name.
export type { DbTransaction as AuthTransaction }
type AuthDbExecutor = typeof db | DbTransaction

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
  tx: DbTransaction,
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

async function lockAccountState(tx: DbTransaction, userId: string) {
  const [row] = await tx
    .select({
      role: user.role,
      status: user.status,
      disabledAt: user.disabled_at,
      adminSuspendedAt: user.admin_suspended_at,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
    .for("update")
  return row ?? null
}

function accountStateColumns(state: AccountStateUpdate) {
  return {
    status: state.status,
    disabled_at: state.disabledAt,
    admin_suspended_at: state.adminSuspendedAt,
  }
}

export async function disableUserIdentity(
  userId: string,
  source: AccountDisableSource,
): Promise<{ disabledAt: Date } | null> {
  return withAdminAccessInvariant(async (tx) => {
    const row = await lockAccountState(tx, userId)
    if (!row) return null

    if (row.status === "active") {
      await assertCanRemoveAdminInTransaction(tx, userId)
    }
    const now = new Date()
    const next = disabledAccountState(row, source, now)
    await tx
      .update(user)
      .set({ ...accountStateColumns(next), updated_at: now })
      .where(eq(user.id, userId))
    return { disabledAt: next.disabledAt ?? now }
  })
}

/**
 * Apply an administrator's role, status, and quota changes. Returns false
 * when the account does not exist.
 */
export async function updateUserIdentityAsAdmin(
  userId: string,
  patch: {
    role?: UserRole
    status?: UserStatus
    storageQuotaBytes?: number | null
  },
): Promise<boolean> {
  return withAdminAccessInvariant(async (tx) => {
    const current = await lockAccountState(tx, userId)
    if (!current) return false

    const nextRole = patch.role ?? current.role
    const nextStatus = patch.status ?? current.status
    const losesAdminAccess =
      current.role === "admin" &&
      current.status === "active" &&
      (nextRole !== "admin" || nextStatus !== "active")
    if (losesAdminAccess) {
      await assertCanRemoveAdminInTransaction(tx, userId)
    }

    const now = new Date()
    const update: Partial<NewUser> = { updated_at: now }
    if (patch.role !== undefined) update.role = patch.role
    if (patch.status !== undefined) {
      Object.assign(
        update,
        accountStateColumns(
          patch.status === "disabled"
            ? disabledAccountState(current, "administrator", now)
            : activeAccountState(),
        ),
      )
    }
    if (patch.storageQuotaBytes !== undefined) {
      update.storage_quota_bytes = patch.storageQuotaBytes
    }
    await tx.update(user).set(update).where(eq(user.id, userId))
    return true
  })
}

export type SelfReactivationResult = "not-found" | "reactivated" | "suspended"

export function reactivateSelfDisabledIdentity(
  userId: string,
): Promise<SelfReactivationResult> {
  return db.transaction(async (tx) => {
    const row = await lockAccountState(tx, userId)
    if (!row) return "not-found"

    const next = selfReactivatedAccountState(row)
    if (!next) return "suspended"

    await tx
      .update(user)
      .set({ ...accountStateColumns(next), updated_at: new Date() })
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
  tx: DbTransaction,
  input: {
    username: string
    setupFirstAdmin: boolean
  },
): Promise<User> {
  const username = validateUsername(input.username)

  if (input.setupFirstAdmin) {
    await lockAdminAccessInvariant(tx)
    // Same config as setupRequired(), so the setup page and this check agree.
    if (await hasAdminSignInMethodWith(tx, currentUsableSignInConfig())) {
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
