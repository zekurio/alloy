import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { z } from "zod"

import { USER_ROLES, user } from "@workspace/db/auth-schema"

import { assertCanRemoveAdmin, createUserIdentity } from "../auth/identity"
import { deleteAllSessionsForUser } from "../auth/session"
import { db } from "../db"
import { errorMessage, selectAdminUserStorageRows } from "./admin-helpers"

const UserIdParam = z.object({
  id: z.string().uuid(),
})

const UserStorageQuotaPatch = z.object({
  storageQuotaBytes: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
})

const CreateUserBody = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().optional(),
  username: z.string().trim().optional(),
  role: z.enum(USER_ROLES).default("user"),
})

const UserRolePatch = z.object({
  role: z.enum(USER_ROLES),
})

function badRequest(c: Context, cause: unknown, fallback: string) {
  return c.json({ error: errorMessage(cause, fallback) }, 400)
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
      return c.json(row ?? created)
    } catch (cause) {
      return badRequest(c, cause, "Couldn't create user.")
    }
  })
  .patch(
    "/users/:id/role",
    zValidator("param", UserIdParam),
    zValidator("json", UserRolePatch),
    async (c) => {
      try {
        const { id } = c.req.valid("param")
        const { role } = c.req.valid("json")
        if (role !== "admin") await assertCanRemoveAdmin(id)
        const [updated] = await db
          .update(user)
          .set({ role, updatedAt: new Date() })
          .where(eq(user.id, id))
          .returning({ id: user.id })
        if (!updated) return c.json({ error: "User not found" }, 404)
        const [row] = await selectAdminUserStorageRows([id])
        return c.json(row)
      } catch (cause) {
        return badRequest(c, cause, "Couldn't update role.")
      }
    }
  )
  .delete("/users/:id", zValidator("param", UserIdParam), async (c) => {
    try {
      const { id } = c.req.valid("param")
      await assertCanRemoveAdmin(id)
      await deleteAllSessionsForUser(id)
      const [deleted] = await db
        .delete(user)
        .where(eq(user.id, id))
        .returning({ id: user.id })
      if (!deleted) return c.json({ error: "User not found" }, 404)
      return c.json({ success: true })
    } catch (cause) {
      return badRequest(c, cause, "Couldn't remove user.")
    }
  })
  .patch(
    "/users/:id/storage-quota",
    zValidator("param", UserIdParam),
    zValidator("json", UserStorageQuotaPatch),
    async (c) => {
      const { id } = c.req.valid("param")
      const { storageQuotaBytes } = c.req.valid("json")

      const [updated] = await db
        .update(user)
        .set({ storageQuotaBytes, updatedAt: new Date() })
        .where(eq(user.id, id))
        .returning({ id: user.id })

      if (!updated) return c.json({ error: "User not found" }, 404)

      const [row] = await selectAdminUserStorageRows([id])
      if (!row) return c.json({ error: "User not found" }, 404)
      return c.json(row)
    }
  )
