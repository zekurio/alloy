import { and, eq, ne } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"

import { db } from "../db"
import { configStore } from "./config-store"

/** LIMIT 1 — cheaper than COUNT(*) when all we need is "any row?". */
export async function hasAnyUser(): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).limit(1)
  return rows.length > 0
}

export async function hasOtherAdmin(excludeUserId: string): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, "admin"), ne(user.id, excludeUserId)))
    .limit(1)
  return rows.length > 0
}

/**
 * Short-circuits on the cheap `setupComplete` flag once it flips; the DB
 * check is only for the first visit before the flag is set.
 */
export async function isSetupRequired(): Promise<boolean> {
  if (configStore.get("setupComplete")) return false
  return !(await hasAnyUser())
}
