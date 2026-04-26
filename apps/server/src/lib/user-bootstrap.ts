import { eq } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"

import { db } from "../db"
import {
  hasAdminSignInMethod,
  hasOtherAdmin,
  setupRequired,
} from "./auth/identity"

export async function hasAnyUser(): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).limit(1)
  return rows.length > 0
}

export { hasOtherAdmin }

export async function isSetupRequired(): Promise<boolean> {
  return setupRequired()
}

export async function hasAnyAdmin(): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, "admin"))
    .limit(1)
  return rows.length > 0
}

export { hasAdminSignInMethod }
