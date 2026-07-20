import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
} from "@alloy/contracts"
import { type NewUser, type User, user } from "@alloy/db/auth-schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { and, eq, ne, sql } from "drizzle-orm"

import {
  hasAdminSignInMethodForConfig,
  hasAdminSignInMethodWith,
} from "./sign-in-config"
import { generateUniqueUsername, normalizeUsername } from "./username"
export {
  countUserPasskeys,
  deleteUserPasskeyPreservingSignIn,
  unlinkOAuthAccountPreservingSignIn,
  userHasEnabledSignInMethod,
} from "./identity-sign-in-methods"

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateUsername(value: string): string {
  return normalizeUsername(value)
}

export function validateDisplayName(value: string): string {
  const displayName = value.trim()
  if (
    displayName.length < DISPLAY_NAME_MIN_LENGTH ||
    displayName.length > DISPLAY_NAME_MAX_LENGTH
  ) {
    throw new Error(
      `Display name must be between ${DISPLAY_NAME_MIN_LENGTH} and ${DISPLAY_NAME_MAX_LENGTH} characters.`,
    )
  }
  if (/[\p{Cc}\p{Cs}]/u.test(displayName)) {
    throw new Error("Display name cannot contain control characters.")
  }
  return displayName
}

export type AuthTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]
type AuthDbExecutor = typeof db | AuthTransaction

const SETUP_ADVISORY_LOCK = sql`select pg_advisory_xact_lock(hashtext('alloy:first-admin-setup'))`

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
  return hasAdminSignInMethodForConfig({
    passkeyEnabled: configStore.get("passkeyEnabled"),
    oauthProviders: configStore.get("oauthProviders"),
  })
}

export async function setupRequired(): Promise<boolean> {
  return !(await hasAdminSignInMethod())
}

async function hasOtherAdminSignInMethod(
  excludeUserId: string,
): Promise<boolean> {
  return hasAdminSignInMethodWith(
    db,
    {
      passkeyEnabled: configStore.get("passkeyEnabled"),
      oauthProviders: configStore.get("oauthProviders"),
    },
    { excludeUserId },
  )
}

export async function assertCanRemoveAdmin(
  targetUserId: string,
): Promise<void> {
  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1)
  if (row?.role !== "admin") return
  if (await hasOtherAdminSignInMethod(targetUserId)) return
  throw new Error(
    "Cannot remove the last admin with a sign-in method. Add a sign-in method to another admin first.",
  )
}

export async function createUserIdentity(input: {
  email: string
  username?: string
  displayName?: string
  role?: "user" | "admin"
}): Promise<User> {
  return createUserIdentityWith(db, input)
}

async function createUserIdentityWith(
  executor: AuthDbExecutor,
  input: {
    email: string
    username?: string
    displayName?: string
    role?: "user" | "admin"
  },
): Promise<User> {
  const email = normalizeEmail(input.email)
  const username = input.username
    ? validateUsername(input.username)
    : await generateUniqueUsername({ email, name: email })
  await assertUsernameAvailable(executor, username)
  const values: NewUser = {
    email,
    email_verified: true,
    username,
    display_name: input.displayName
      ? validateDisplayName(input.displayName)
      : username,
    role: input.role ?? "user",
    storage_quota_bytes: configStore.get("limits").defaultStorageQuotaBytes,
  }
  const [created] = await executor.insert(user).values(values).returning()
  if (!created) throw new Error("Could not create user.")
  return created
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.email, normalizeEmail(email)))
    .limit(1)
  return row ?? null
}

async function createOrClaimSetupUserWith(
  executor: AuthDbExecutor,
  input: {
    email: string
    username: string
    displayName?: string
  },
): Promise<{ user: User; created: boolean }> {
  const email = normalizeEmail(input.email)
  const [existing] = await executor
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (existing) {
    const now = new Date()
    const username = validateUsername(input.username)
    await assertUsernameAvailable(executor, username, existing.id)
    const [updated] = await executor
      .update(user)
      .set({
        role: "admin",
        status: "active",
        disabled_at: null,
        username,
        display_name: input.displayName
          ? validateDisplayName(input.displayName)
          : existing.display_name || username,
        updated_at: now,
      })
      .where(eq(user.id, existing.id))
      .returning()
    if (!updated) throw new Error("Could not claim setup user.")
    return { user: updated, created: false }
  }
  return {
    user: await createUserIdentityWith(executor, {
      email,
      username: input.username,
      displayName: input.displayName,
      role: "admin",
    }),
    created: true,
  }
}

export async function createRegistrationUserInTransaction(
  tx: AuthTransaction,
  input: {
    email: string
    username: string
    displayName?: string
    setupFirstAdmin: boolean
  },
): Promise<{ user: User; created: boolean }> {
  const email = normalizeEmail(input.email)
  const username = validateUsername(input.username)

  if (input.setupFirstAdmin) {
    await tx.execute(SETUP_ADVISORY_LOCK)
    if (
      await hasAdminSignInMethodWith(tx, {
        passkeyEnabled: configStore.get("passkeyEnabled"),
        oauthProviders: configStore.get("oauthProviders"),
      })
    ) {
      throw new Error("Initial setup is already complete.")
    }
    return createOrClaimSetupUserWith(tx, {
      email,
      username,
      displayName: input.displayName,
    })
  }

  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-up is currently disabled.")
  }
  const [existing] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (existing) {
    throw new Error("An account already exists for that email address.")
  }
  if (!configStore.get("openRegistrations")) {
    throw new Error("Sign-up is currently closed.")
  }
  return {
    user: await createUserIdentityWith(tx, {
      email,
      username,
      displayName: input.displayName,
      role: "user",
    }),
    created: true,
  }
}

export async function updateUserIdentity(
  userId: string,
  input: { email?: string; username?: string; displayName?: string },
): Promise<User> {
  const patch: Partial<NewUser> = { updated_at: new Date() }
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email)
    const existing = await findUserByEmail(email)
    if (existing && existing.id !== userId) {
      throw new Error("An account already exists for that email address.")
    }
    patch.email = email
    patch.email_verified = true
  }
  if (input.username !== undefined) {
    const username = validateUsername(input.username)
    await assertUsernameAvailable(db, username, userId)
    patch.username = username
  }
  if (input.displayName !== undefined) {
    patch.display_name = validateDisplayName(input.displayName)
  }
  const [updated] = await db
    .update(user)
    .set(patch)
    .where(eq(user.id, userId))
    .returning()
  if (!updated) throw new Error("User not found.")
  return updated
}
