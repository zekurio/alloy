import { optionalTrimmedString, zValidator } from "./validation"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { USER_ROLES, user } from "@workspace/db/auth-schema"

import { assertCanRemoveAdmin, createUserIdentity } from "../auth/identity"
import { deleteAllSessionsForUser } from "../auth/session"
import { db } from "../db"
import {
  badRequestFromCause,
  internalServerError,
  notFound,
  success,
} from "../runtime/http-response"
import { selectAdminUserStorageRows } from "./admin-helpers"

const UserIdParam = z.object({
  id: z.string().uuid(),
})

const StorageQuotaValue = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()

const CreateUserBody = z.object({
  email: z.string().trim().email(),
  name: optionalTrimmedString(),
  username: optionalTrimmedString(),
  role: z.enum(USER_ROLES).default("user"),
})

const UserPatch = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    storageQuotaBytes: StorageQuotaValue.optional(),
  })
  .refine(
    (patch) =>
      patch.role !== undefined || patch.storageQuotaBytes !== undefined,
    { message: "No updates provided" }
  )

async function updateAdminUser(id: string, patch: z.infer<typeof UserPatch>) {
  if (patch.role !== undefined && patch.role !== "admin") {
    await assertCanRemoveAdmin(id)
  }

  const update: Partial<typeof user.$inferInsert> = { updatedAt: new Date() }
  if (patch.role !== undefined) update.role = patch.role
  if (patch.storageQuotaBytes !== undefined) {
    update.storageQuotaBytes = patch.storageQuotaBytes
  }

  const [updated] = await db
    .update(user)
    .set(update)
    .where(eq(user.id, id))
    .returning({ id: user.id })
  if (!updated) return null

  const [row] = await selectAdminUserStorageRows([id])
  return row ?? null
}

export const adminUsersRoute = new Hono()
  .get("/users", async (c) => {
    return c.json({ users: await selectAdminUserStorageRows() })
  })
  .post("/users", zValidator("json", CreateUserBody), async (c) => {
    try {
      const body = c.req.valid("json")
      const created = await createUserIdentity({
        email: body.email,
        username: body.username,
        name: body.name,
        role: body.role,
      })
      const [row] = await selectAdminUserStorageRows([created.id])
      if (!row) {
        return internalServerError(c, "Created user could not be loaded")
      }
      return c.json(row)
    } catch (cause) {
      return badRequestFromCause(c, cause, "Couldn't create user.")
    }
  })
  .delete("/users/:id", zValidator("param", UserIdParam), async (c) => {
    try {
      const { id } = c.req.valid("param")
      await assertCanRemoveAdmin(id)
      await deleteAllSessionsForUser(id)
      const [deleted] = await db
        .delete(user)
        .where(eq(user.id, id))
        .returning({ id: user.id })
      if (!deleted) return notFound(c, "User not found")
      return success(c)
    } catch (cause) {
      return badRequestFromCause(c, cause, "Couldn't remove user.")
    }
  })
  .patch(
    "/users/:id",
    zValidator("param", UserIdParam),
    zValidator("json", UserPatch),
    async (c) => {
      try {
        const { id } = c.req.valid("param")
        const patch = c.req.valid("json")
        const row = await updateAdminUser(id, patch)
        if (!row) return notFound(c, "User not found")
        return c.json(row)
      } catch (cause) {
        return badRequestFromCause(c, cause, "Couldn't update user.")
      }
    }
  )
