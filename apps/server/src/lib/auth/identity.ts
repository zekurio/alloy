import { and, count, eq, ne } from "drizzle-orm"

import { user, userPasskey, type NewUser, type User } from "@workspace/db/auth-schema"

import { db } from "../../db"
import { configStore } from "../config-store"
import {
  generateUniqueUsername,
  slugifyUsername,
  USERNAME_MAX_LEN,
  USERNAME_MIN_LEN,
} from "../username"

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateUsername(value: string): string {
  const username = value.trim().toLowerCase()
  if (username.length < USERNAME_MIN_LEN || username.length > USERNAME_MAX_LEN) {
    throw new Error(
      `Username must be between ${USERNAME_MIN_LEN} and ${USERNAME_MAX_LEN} characters.`
    )
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    throw new Error("Username can only contain lowercase letters, numbers, underscores, and hyphens.")
  }
  return username
}

export async function hasAdminSignInMethod(): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(userPasskey, eq(userPasskey.userId, user.id))
    .where(and(eq(user.role, "admin"), eq(user.status, "active")))
    .limit(1)
  return rows.length > 0
}

export async function setupRequired(): Promise<boolean> {
  const required = !(await hasAdminSignInMethod())
  if (!required && !configStore.get("setupComplete")) {
    configStore.set("setupComplete", true)
  }
  return required
}

export async function hasOtherAdmin(excludeUserId: string): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, "admin"), ne(user.id, excludeUserId)))
    .limit(1)
  return rows.length > 0
}

export async function assertCanRemoveAdmin(targetUserId: string): Promise<void> {
  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1)
  if (row?.role !== "admin") return
  if (await hasOtherAdmin(targetUserId)) return
  throw new Error("Cannot remove the last admin account. Promote another user to admin first.")
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
}): Promise<User> {
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
    return updated
  }
  return createUserIdentity({
    email,
    username: input.username,
    name: input.username,
    role: "admin",
  })
}

export async function createRegistrationUser(input: {
  email: string
  username: string
  setupFirstAdmin: boolean
}): Promise<User> {
  if (input.setupFirstAdmin) {
    if (!(await setupRequired())) {
      throw new Error("Initial setup is already complete.")
    }
    return createOrClaimSetupUser(input)
  }
  if (!configStore.get("openRegistrations")) {
    throw new Error("Sign-up is currently closed.")
  }
  if (!configStore.get("passkeyEnabled")) {
    throw new Error("Passkey sign-up is currently disabled.")
  }
  if (await findUserByEmail(input.email)) {
    throw new Error("An account already exists for that email address.")
  }
  return createUserIdentity({
    email: input.email,
    username: input.username,
    name: input.username,
    role: "user",
  })
}

export async function updateUserIdentity(
  userId: string,
  input: { name?: string; username?: string }
): Promise<User> {
  const patch: Partial<NewUser> = { updatedAt: new Date() }
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

export function normalizeDisplayUsername(username: string): string {
  return slugifyUsername(username)
}
