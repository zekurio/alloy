import { type NewUser, type User, user } from "@workspace/db/auth-schema"
import { and, eq, ne, sql } from "drizzle-orm"

import { configStore } from "../config/store"
import { db } from "../db"
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
  name?: string
  role?: "user" | "admin"
}): Promise<User> {
  return createUserIdentityWith(db, input)
}

async function createUserIdentityWith(
  executor: AuthDbExecutor,
  input: {
    email: string
    username?: string
    name?: string
    role?: "user" | "admin"
  },
): Promise<User> {
  const email = normalizeEmail(input.email)
  const username = input.username
    ? validateUsername(input.username)
    : await generateUniqueUsername({ email, name: input.name ?? email })
  await assertUsernameAvailable(executor, username)
  const values: NewUser = {
    email,
    emailVerified: true,
    username,
    name: (input.name ?? username).trim(),
    role: input.role ?? "user",
    storageQuotaBytes: configStore.get("limits").defaultStorageQuotaBytes,
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
        disabledAt: null,
        username,
        name: existing.name || input.username,
        updatedAt: now,
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
      name: input.username,
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
    return createOrClaimSetupUserWith(tx, { email, username })
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
      name: username,
      role: "user",
    }),
    created: true,
  }
}

export async function updateUserIdentity(
  userId: string,
  input: { email?: string; name?: string; username?: string },
): Promise<User> {
  const patch: Partial<NewUser> = { updatedAt: new Date() }
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email)
    const existing = await findUserByEmail(email)
    if (existing && existing.id !== userId) {
      throw new Error("An account already exists for that email address.")
    }
    patch.email = email
    patch.emailVerified = true
  }
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.username !== undefined) {
    const username = validateUsername(input.username)
    await assertUsernameAvailable(db, username, userId)
    patch.username = username
  }
  const [updated] = await db
    .update(user)
    .set(patch)
    .where(eq(user.id, userId))
    .returning()
  if (!updated) throw new Error("User not found.")
  return updated
}
