import { user } from "../db/auth-schema"
import { db } from "../db"
import { configStore } from "./config-store"

/** LIMIT 1 — cheaper than COUNT(*) when all we need is "any row?". */
export async function hasAnyUser(): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).limit(1)
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
