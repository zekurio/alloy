import { and, count, eq, ne, sql } from "drizzle-orm"

import {
  authAccount,
  user,
  userPasskey,
  type NewUser,
  type User,
} from "@workspace/db/auth-schema"

import { db } from "../db"
import { configStore } from "../config/store"
import {
  generateUniqueUsername,
  slugifyUsername,
  USERNAME_MAX_LEN,
  USERNAME_MIN_LEN,
} from "./username"

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateUsername(value: string): string {
  const username = value.trim().toLowerCase()
  if (
    username.length < USERNAME_MIN_LEN ||
    username.length > USERNAME_MAX_LEN
  ) {
    throw new Error(
      `Username must be between ${USERNAME_MIN_LEN} and ${USERNAME_MAX_LEN} characters.`
    )
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    throw new Error(
      "Username can only contain lowercase letters, numbers, underscores, and hyphens."
    )
  }
  return username
}

type SignInMethodConfig = {
  passkeyEnabled: boolean
  oauthProvider: { enabled: boolean; providerId: string } | null
}

export async function hasAdminSignInMethod(): Promise<boolean> {
  return hasAdminSignInMethodForConfig({
    passkeyEnabled: configStore.get("passkeyEnabled"),
    oauthProvider: configStore.get("oauthProvider"),
  })
}

export async function hasAdminSignInMethodForConfig(
  config: SignInMethodConfig
): Promise<boolean> {
  if (config.passkeyEnabled) {
    const passkeyRows = await db
      .select({ id: user.id })
      .from(user)
      .innerJoin(userPasskey, eq(userPasskey.userId, user.id))
      .where(and(eq(user.role, "admin"), eq(user.status, "active")))
      .limit(1)
    if (passkeyRows.length > 0) return true
  }

  const provider = config.oauthProvider
  if (!provider?.enabled) return false

  const oauthRows = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(authAccount, eq(authAccount.userId, user.id))
    .where(
      and(
        eq(user.role, "admin"),
        eq(user.status, "active"),
        eq(authAccount.providerId, provider.providerId)
      )
    )
    .limit(1)
  return oauthRows.length > 0
}

export async function setupRequired(): Promise<boolean> {
  return !(await hasAdminSignInMethod())
}

export async function hasOtherAdminSignInMethod(
  excludeUserId: string
): Promise<boolean> {
  if (configStore.get("passkeyEnabled")) {
    const passkeyRows = await db
      .select({ id: user.id })
      .from(user)
      .innerJoin(userPasskey, eq(userPasskey.userId, user.id))
      .where(
        and(
          eq(user.role, "admin"),
          eq(user.status, "active"),
          ne(user.id, excludeUserId)
        )
      )
      .limit(1)
    if (passkeyRows.length > 0) return true
  }

  const provider = configStore.get("oauthProvider")
  if (!provider?.enabled) return false

  const oauthRows = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(authAccount, eq(authAccount.userId, user.id))
    .where(
      and(
        eq(user.role, "admin"),
        eq(user.status, "active"),
        ne(user.id, excludeUserId),
        eq(authAccount.providerId, provider.providerId)
      )
    )
    .limit(1)
  return oauthRows.length > 0
}

export async function assertCanRemoveAdmin(
  targetUserId: string
): Promise<void> {
  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1)
  if (row?.role !== "admin") return
  if (await hasOtherAdminSignInMethod(targetUserId)) return
  throw new Error(
    "Cannot remove the last admin with a sign-in method. Add a sign-in method to another admin first."
  )
}

export async function createUserIdentity(input: {
  email: string
  username?: string
  name?: string
  role?: "user" | "admin"
}): Promise<User> {
  const email = normalizeEmail(input.email)
  const username = input.username
    ? validateUsername(input.username)
    : await generateUniqueUsername({ email, name: input.name ?? email })
  const values: NewUser = {
    email,
    emailVerified: true,
    username,
    name: (input.name ?? username).trim(),
    role: input.role ?? "user",
    storageQuotaBytes: configStore.get("limits").defaultStorageQuotaBytes,
  }
  const [created] = await db.insert(user).values(values).returning()
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

export async function createOrClaimSetupUser(input: {
  email: string
  username: string
}): Promise<{ user: User; created: boolean }> {
  const email = normalizeEmail(input.email)
  const existing = await findUserByEmail(email)
  if (existing) {
    const now = new Date()
    const [updated] = await db
      .update(user)
      .set({
        role: "admin",
        status: "active",
        disabledAt: null,
        username: validateUsername(input.username),
        name: existing.name || input.username,
        updatedAt: now,
      })
      .where(eq(user.id, existing.id))
      .returning()
    if (!updated) throw new Error("Could not claim setup user.")
    return { user: updated, created: false }
  }
  return {
    user: await createUserIdentity({
      email,
      username: input.username,
      name: input.username,
      role: "admin",
    }),
    created: true,
  }
}

export async function createRegistrationUser(input: {
  email: string
  username: string
  setupFirstAdmin: boolean
}): Promise<{ user: User; created: boolean }> {
  if (input.setupFirstAdmin) {
    if (!(await setupRequired())) {
      throw new Error("Initial setup is already complete.")
    }
    return createOrClaimSetupUser(input)
  }
  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-up is currently disabled.")
  }
  const existing = await findUserByEmail(input.email)
  if (existing) {
    throw new Error("An account already exists for that email address.")
  }
  if (!configStore.get("openRegistrations")) {
    throw new Error("Sign-up is currently closed.")
  }
  return {
    user: await createUserIdentity({
      email: input.email,
      username: input.username,
      name: input.username,
      role: "user",
    }),
    created: true,
  }
}

export async function updateUserIdentity(
  userId: string,
  input: { email?: string; name?: string; username?: string }
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
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, username))
      .limit(1)
    if (existing && existing.id !== userId) {
      throw new Error("Username is already taken.")
    }
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

export async function countUserPasskeys(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(userPasskey)
    .where(eq(userPasskey.userId, userId))
  return row?.value ?? 0
}

type AuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type AuthExecutor = typeof db | AuthTransaction

async function countEnabledOAuthAccounts(
  userId: string,
  excludeAccount?: { providerId: string; providerAccountId: string },
  executor: AuthExecutor = db
): Promise<number> {
  const provider = configStore.get("oauthProvider")
  if (!provider?.enabled) return 0

  const rows = await executor
    .select({
      providerAccountId: authAccount.providerAccountId,
      providerId: authAccount.providerId,
    })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.userId, userId),
        eq(authAccount.providerId, provider.providerId)
      )
    )

  return rows.filter(
    (row) =>
      !excludeAccount ||
      row.providerId !== excludeAccount.providerId ||
      row.providerAccountId !== excludeAccount.providerAccountId
  ).length
}

export async function userHasEnabledSignInMethod(
  userId: string,
  options: {
    excludeAccount?: { providerId: string; providerAccountId: string }
    excludePasskeyId?: string
    executor?: AuthExecutor
  } = {}
): Promise<boolean> {
  const executor = options.executor ?? db
  if (configStore.get("passkeyEnabled")) {
    const passkeys = await executor
      .select({ id: userPasskey.id })
      .from(userPasskey)
      .where(eq(userPasskey.userId, userId))
    if (passkeys.some((passkey) => passkey.id !== options.excludePasskeyId)) {
      return true
    }
  }

  return (
    (await countEnabledOAuthAccounts(
      userId,
      options.excludeAccount,
      executor
    )) > 0
  )
}

async function lockUserSignInMethods(
  tx: AuthTransaction,
  userId: string
): Promise<void> {
  await tx.execute(sql`
    select ${user.id}
    from ${user}
    where ${user.id} = ${userId}
    for update
  `)
}

export async function deleteUserPasskeyPreservingSignIn(input: {
  userId: string
  passkeyId: string
}): Promise<"deleted" | "not-found" | "last-sign-in-method"> {
  return db.transaction(async (tx) => {
    await lockUserSignInMethods(tx, input.userId)

    if (
      !(await userHasEnabledSignInMethod(input.userId, {
        excludePasskeyId: input.passkeyId,
        executor: tx,
      }))
    ) {
      return "last-sign-in-method"
    }

    const [deleted] = await tx
      .delete(userPasskey)
      .where(
        and(
          eq(userPasskey.id, input.passkeyId),
          eq(userPasskey.userId, input.userId)
        )
      )
      .returning({ id: userPasskey.id })

    return deleted ? "deleted" : "not-found"
  })
}

export async function unlinkOAuthAccountPreservingSignIn(input: {
  userId: string
  providerId: string
  providerAccountId: string
}): Promise<"deleted" | "not-found" | "last-sign-in-method"> {
  return db.transaction(async (tx) => {
    await lockUserSignInMethods(tx, input.userId)

    if (
      !(await userHasEnabledSignInMethod(input.userId, {
        excludeAccount: {
          providerId: input.providerId,
          providerAccountId: input.providerAccountId,
        },
        executor: tx,
      }))
    ) {
      return "last-sign-in-method"
    }

    const [deleted] = await tx
      .delete(authAccount)
      .where(
        and(
          eq(authAccount.userId, input.userId),
          eq(authAccount.providerId, input.providerId),
          eq(authAccount.providerAccountId, input.providerAccountId)
        )
      )
      .returning({ id: authAccount.id })

    return deleted ? "deleted" : "not-found"
  })
}

export function normalizeDisplayUsername(username: string): string {
  return slugifyUsername(username)
}
