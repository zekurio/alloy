import { zValidator } from "@hono/zod-validator"
import { eq, inArray } from "drizzle-orm"
import type { Context } from "hono"
import { Hono } from "hono"
import { z } from "zod"

import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { assertCanRemoveAdmin, createUserIdentity } from "../auth/identity"
import { deleteAllSessionsForUser, requireAdmin } from "../auth/session"
import {
  EncoderConfigPatchSchema,
  IntegrationsConfigPatchSchema,
  LimitsConfigPatchSchema,
  StorageConfigPatchSchema,
  configStore,
  type RuntimeConfig,
} from "../config/store"
import { ENCODE_JOB, getBoss } from "../queue"
import { getEncoderCapabilities } from "./admin-encoder-capabilities"
import {
  REDACTED_SENTINEL,
  adminRuntimeConfigResponse,
  errorMessage,
  finalizeOAuthProviderSubmission,
  hasEnabledSignInMethod,
  mergeStorageConfigPatch,
  preserveRedactedSecrets,
  selectAdminUserStorageRows,
} from "./admin-helpers"

const RE_ENCODE_BATCH_LIMIT = 100

const RuntimeConfigPatch = z.object({
  openRegistrations: z.boolean().optional(),
  passkeyEnabled: z.boolean().optional(),
  requireAuthToBrowse: z.boolean().optional(),
})

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
  role: z.enum(["user", "admin"]).default("user"),
})

const UserRolePatch = z.object({
  role: z.enum(["user", "admin"]),
})

const OAuthProviderAdminSubmissionSchema = z
  .object({
    providerId: z.string().optional(),
  })
  .passthrough()

const OAuthConfigSubmissionSchema = z.object({
  oauthProvider: OAuthProviderAdminSubmissionSchema.nullable(),
})

function badRequest(c: Context, cause: unknown, fallback: string) {
  return c.json({ error: errorMessage(cause, fallback) }, 400)
}

export const adminRoute = new Hono()
  .use("*", requireAdmin)
  .get("/runtime-config", (c) => {
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .post("/runtime-config/reload", (c) => {
    if (!configStore.reload()) {
      return c.json({ error: "Runtime config file failed validation." }, 400)
    }
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .get("/runtime-config/export", (c) => {
    c.header("Content-Disposition", 'attachment; filename="alloy-config.json"')
    return c.json(configStore.getAll())
  })
  .put("/runtime-config/import", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON." }, 400)
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Expected a JSON object." }, 400)
    }
    const input = body as Record<string, unknown>
    const current = configStore.getAll()
    preserveRedactedSecrets(input, current)
    try {
      const next = {
        ...current,
        ...input,
      }
      if (!hasEnabledSignInMethod(next)) {
        return c.json(
          {
            error: "Keep at least one sign-in method enabled.",
          },
          400
        )
      }
      configStore.patch(input as Partial<RuntimeConfig>)
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    } catch (cause) {
      return badRequest(c, cause, "Invalid configuration.")
    }
  })
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
  .patch(
    "/runtime-config",
    zValidator("json", RuntimeConfigPatch),
    async (c) => {
      const body = c.req.valid("json")
      const current = configStore.getAll()
      const next = {
        ...current,
        ...body,
      }
      if (!hasEnabledSignInMethod(next)) {
        return c.json(
          {
            error: "Keep at least one sign-in method enabled.",
          },
          400
        )
      }
      const patch: Partial<{
        openRegistrations: boolean
        passkeyEnabled: boolean
        requireAuthToBrowse: boolean
      }> = {}
      if (body.openRegistrations !== undefined) {
        patch.openRegistrations = body.openRegistrations
      }
      if (body.passkeyEnabled !== undefined) {
        patch.passkeyEnabled = body.passkeyEnabled
      }
      if (body.requireAuthToBrowse !== undefined) {
        patch.requireAuthToBrowse = body.requireAuthToBrowse
      }
      if (Object.keys(patch).length > 0) configStore.patch(patch)
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    }
  )
  .put(
    "/oauth-config",
    zValidator("json", OAuthConfigSubmissionSchema),
    (c) => {
      const submission = c.req.valid("json")
      const existing = configStore.get("oauthProvider")
      try {
        const nextProvider = submission.oauthProvider
          ? finalizeOAuthProviderSubmission(submission.oauthProvider, existing)
          : null
        if (
          !hasEnabledSignInMethod({
            passkeyEnabled: configStore.get("passkeyEnabled"),
            oauthProvider: nextProvider,
          })
        ) {
          return c.json(
            {
              error: "Keep at least one sign-in method enabled.",
            },
            400
          )
        }
        configStore.patch({ oauthProvider: nextProvider })
      } catch (cause) {
        return badRequest(c, cause, "Couldn't save OAuth configuration.")
      }
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    }
  )

  /**
   * PATCH /encoder — update the encoder profile. Partial — admins usually
   * flip one knob at a time. Changes apply to the next encode job; jobs
   * already running finish on the previous config.
   */
  .patch("/encoder", zValidator("json", EncoderConfigPatchSchema), (c) => {
    const patch = c.req.valid("json")
    const next = { ...configStore.get("encoder"), ...patch }
    configStore.set("encoder", next)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })

  /**
   * PATCH /limits — update upload + queue limits. `maxUploadBytes` and
   * `uploadTtlSec` are picked up on the next `/initiate` call.
   * `queueConcurrency` is re-registered after currently running encode jobs
   * finish, without requiring a server restart.
   */
  .patch("/limits", zValidator("json", LimitsConfigPatchSchema), (c) => {
    const patch = c.req.valid("json")
    const next = { ...configStore.get("limits"), ...patch }
    configStore.set("limits", next)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })

  .patch(
    "/integrations",
    zValidator("json", IntegrationsConfigPatchSchema),
    (c) => {
      const patch = c.req.valid("json")
      const current = configStore.get("integrations")
      const next: typeof current = { ...current }
      if (patch.steamgriddbApiKey !== undefined) {
        next.steamgriddbApiKey =
          patch.steamgriddbApiKey === REDACTED_SENTINEL
            ? current.steamgriddbApiKey
            : patch.steamgriddbApiKey
      }
      configStore.set("integrations", next)
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    }
  )

  /**
   * PATCH /storage — update the active storage driver configuration. The
   * server rebuilds the driver immediately for new operations; in-flight
   * uploads/downloads continue on the driver instance they already entered.
   */
  .patch("/storage", zValidator("json", StorageConfigPatchSchema), (c) => {
    const patch = c.req.valid("json")
    const current = configStore.get("storage")
    const next = mergeStorageConfigPatch(current, patch)

    try {
      configStore.set("storage", next)
    } catch (cause) {
      return badRequest(c, cause, "Couldn't save storage configuration.")
    }
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })

  .get("/encoder/capabilities", async (c) => {
    return c.json(await getEncoderCapabilities())
  })

  .post("/clips/re-encode", async (c) => {
    const rows = await db
      .select({ id: clip.id })
      .from(clip)
      .where(inArray(clip.status, ["ready", "failed"]))
      .orderBy(clip.createdAt)
      .limit(RE_ENCODE_BATCH_LIMIT)
    if (rows.length === 0) {
      return c.json({ enqueued: 0, hasMore: false })
    }
    const ids = rows.map((r) => r.id)
    await db
      .update(clip)
      .set({
        status: "uploaded",
        encodeProgress: 0,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(inArray(clip.id, ids))

    const boss = await getBoss()
    for (const id of ids) {
      await boss.send(ENCODE_JOB, { clipId: id })
    }
    return c.json({
      enqueued: ids.length,
      hasMore: ids.length === RE_ENCODE_BATCH_LIMIT,
    })
  })
