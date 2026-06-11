import { USER_STATUSES } from "@alloy/contracts"
import { user, USER_ROLES } from "@alloy/db/auth-schema"
import {
  assertCanRemoveAdmin,
  createUserIdentity,
} from "@alloy/server/auth/identity"
import { deleteAllSessionsForUser } from "@alloy/server/auth/session"
import { db } from "@alloy/server/db/index"
import {
  badRequestFromCause,
  internalServerError,
  notFound,
  success,
} from "@alloy/server/runtime/http-response"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { selectAdminUserStorageRows } from "./admin-helpers"
import { optionalTrimmedString, zValidator } from "./validation"

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
  username: optionalTrimmedString(),
  role: z.enum(USER_ROLES).default("user"),
})

const UserPatch = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    storageQuotaBytes: StorageQuotaValue.optional(),
  })
  .refine(
    (patch) =>
      patch.role !== undefined ||
      patch.status !== undefined ||
      patch.storageQuotaBytes !== undefined,
    { message: "No updates provided" },
  )

async function updateAdminUser(id: string, patch: z.infer<typeof UserPatch>) {
  const demoting = patch.role !== undefined && patch.role !== "admin"
  const disabling = patch.status === "disabled"
  // Both losing admin and being disabled remove the account's admin access, so
  // guard against locking out the last usable admin.
  if (demoting || disabling) {
    await assertCanRemoveAdmin(id)
  }

  const now = new Date()
  const update: Partial<typeof user.$inferInsert> = { updatedAt: now }
  if (patch.role !== undefined) update.role = patch.role
  if (patch.status !== undefined) {
    update.status = patch.status
    update.disabledAt = patch.status === "disabled" ? now : null
  }
  if (patch.storageQuotaBytes !== undefined) {
    update.storageQuotaBytes = patch.storageQuotaBytes
  }

  const [updated] = await db
    .update(user)
    .set(update)
    .where(eq(user.id, id))
    .returning({ id: user.id })
  if (!updated) return null

  // A disabled account must not keep live sessions.
  if (disabling) await deleteAllSessionsForUser(id)

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
    },
  )
