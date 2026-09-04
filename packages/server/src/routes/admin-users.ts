import { USER_STATUSES } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { user, USER_ROLES } from "@alloy/db/auth-schema"
import {
  activeAccountState,
  disabledAccountState,
} from "@alloy/server/auth/account-state"
import {
  assertCanRemoveAdminInTransaction,
  createUserIdentity,
  withAdminAccessInvariant,
} from "@alloy/server/auth/identity"
import { deleteAllSessionsForUser } from "@alloy/server/auth/session"
import {
  badRequestFromCause,
  internalServerError,
  notFound,
  success,
} from "@alloy/server/runtime/http-response"
import { deleteUserAccount } from "@alloy/server/users/account-deletion"
import { accountDeletionState } from "@alloy/server/users/account-deletion-state"
import { eq } from "drizzle-orm"
import { Hono } from "hono"

import {
  selectAdminUserStoragePage,
  selectAdminUserStorageRows,
} from "./admin-helpers"
import {
  cursorTimestampText,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import { requiredTrimmedString, tbValidator } from "./validation"

const UserIdParam = t.object({
  id: t.string().uuid(),
})

const UsersQuery = t.object({
  cursor: t.string().optional(),
  limit: t.coerce.number().int().min(1).max(100).$default(50),
  search: t.string().trim().max(100).optional(),
})

const StorageQuotaValue = t
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()

const CreateUserBody = t.object({
  username: requiredTrimmedString(),
  role: t.enum(USER_ROLES).$default("user"),
})

const UserPatch = t
  .object({
    role: t.enum(USER_ROLES).optional(),
    status: t.enum(USER_STATUSES).optional(),
    storageQuotaBytes: StorageQuotaValue.optional(),
  })
  .refine(
    (patch) =>
      patch.role !== undefined ||
      patch.status !== undefined ||
      patch.storageQuotaBytes !== undefined,
    { message: "No updates provided" },
  )

async function updateAdminUser(id: string, patch: t.infer<typeof UserPatch>) {
  const disabling = patch.status === "disabled"
  const mutate = () =>
    withAdminAccessInvariant(async (tx) => {
      const [current] = await tx
        .select({
          role: user.role,
          status: user.status,
          disabledAt: user.disabled_at,
          adminSuspendedAt: user.admin_suspended_at,
        })
        .from(user)
        .where(eq(user.id, id))
        .limit(1)
        .for("update")
      if (!current) return null

      const nextRole = patch.role ?? current.role
      const nextStatus = patch.status ?? current.status
      const losesAdminAccess =
        current.role === "admin" &&
        current.status === "active" &&
        (nextRole !== "admin" || nextStatus !== "active")
      if (losesAdminAccess) {
        await assertCanRemoveAdminInTransaction(tx, id)
      }

      const now = new Date()
      const update: Partial<typeof user.$inferInsert> = { updated_at: now }
      if (patch.role !== undefined) update.role = patch.role
      if (patch.status !== undefined) {
        const accountState =
          patch.status === "disabled"
            ? disabledAccountState(current, "administrator", now)
            : activeAccountState()
        update.status = accountState.status
        update.disabled_at = accountState.disabledAt
        update.admin_suspended_at = accountState.adminSuspendedAt
      }
      if (patch.storageQuotaBytes !== undefined) {
        update.storage_quota_bytes = patch.storageQuotaBytes
      }

      const [updated] = await tx
        .update(user)
        .set(update)
        .where(eq(user.id, id))
        .returning({ id: user.id })
      return updated ?? null
    })

  const updated =
    patch.status === "active"
      ? await accountDeletionState.withInactive(id, mutate)
      : { ok: true as const, value: await mutate() }
  if (!updated.ok) throw new Error("Account deletion is in progress.")
  if (!updated.value) return null

  // A disabled account must not keep live sessions.
  if (disabling) await deleteAllSessionsForUser(id)

  const [row] = await selectAdminUserStorageRows([id])
  return row ?? null
}

function decodeUsersCursor(
  value: string | undefined,
): { createdAt: string; id: string } | null {
  const payload = decodeCursorPayload(value)
  if (!payload) return null
  // createdAt is cast back to ::timestamp and id to uuid in the query, so a
  // crafted cursor with a bad shape would raise a DB error — reject it here.
  const createdAt = cursorTimestampText(payload.createdAt)
  const id = t.string().uuid().safeParse(payload.id)
  if (!createdAt || !id.success) return null
  return { createdAt, id: id.data }
}

export const adminUsersRoute = new Hono()
  .get("/users", tbValidator("query", UsersQuery), async (c) => {
    const query = c.req.valid("query")
    const page = await selectAdminUserStoragePage({
      cursor: decodeUsersCursor(query.cursor),
      limit: query.limit,
      search: query.search,
    })
    return c.json({
      users: page.users,
      nextCursor: page.nextCursor ? encodeCursorPayload(page.nextCursor) : null,
      total: page.total,
    })
  })
  .post("/users", tbValidator("json", CreateUserBody), async (c) => {
    try {
      const body = c.req.valid("json")
      const created = await createUserIdentity({
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
  .delete("/users/:id", tbValidator("param", UserIdParam), async (c) => {
    try {
      const { id } = c.req.valid("param")
      const deleted = await deleteUserAccount(id, "administrator")
      if (deleted === "not-found") return notFound(c, "User not found")
      return success(c)
    } catch (cause) {
      return badRequestFromCause(c, cause, "Couldn't remove user.")
    }
  })
  .patch(
    "/users/:id",
    tbValidator("param", UserIdParam),
    tbValidator("json", UserPatch),
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
