import { zValidator } from "@hono/zod-validator"
import { desc, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { env } from "../env"
import {
  assertCanRemoveAdmin,
  createUserIdentity,
} from "../lib/auth/identity"
import { deleteAllSessionsForUser, requireAdmin } from "../lib/auth/session"
import {
  EncoderConfigPatchSchema,
  IntegrationsConfigPatchSchema,
  LimitsConfigPatchSchema,
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
  StorageConfigPatchSchema,
  configStore,
  type OAuthProviderConfig,
  type RuntimeConfig,
} from "../lib/config-store"
import { selectSourceStorageUsedBytesByUserIds } from "../lib/storage-quota"
import { ENCODE_JOB, getBoss } from "../queue"
import { getEncoderCapabilities } from "./admin-encoder-capabilities"

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

type OAuthProviderAdminSubmission = Record<string, unknown> & {
  providerId?: string
}

const REDACTED_SENTINEL = "***"

function redactSecrets(
  config: Readonly<RuntimeConfig>
): Readonly<RuntimeConfig> {
  return {
    ...config,
    integrations: {
      ...config.integrations,
      steamgriddbApiKey: config.integrations.steamgriddbApiKey
        ? REDACTED_SENTINEL
        : "",
    },
    oauthProvider: config.oauthProvider
      ? { ...config.oauthProvider, clientSecret: "" }
      : null,
    storage: {
      ...config.storage,
      fs: {
        ...config.storage.fs,
        hmacSecret: config.storage.fs.hmacSecret ? REDACTED_SENTINEL : "",
      },
      s3: {
        ...config.storage.s3,
        secretAccessKey: config.storage.s3.secretAccessKey
          ? REDACTED_SENTINEL
          : "",
      },
    },
  }
}

function adminRuntimeConfigResponse(config: Readonly<RuntimeConfig>) {
  return {
    ...redactSecrets(config),
    authBaseURL: env.PUBLIC_SERVER_URL,
  }
}

/**
 * When importing a previously-exported config that was round-tripped through
 * the redacting response helper, secret fields will contain sentinel values.
 * Replace those sentinels with the real values from the current config so the
 * import doesn't wipe secrets the admin never intended to change.
 */
function preserveRedactedSecrets(
  input: Record<string, unknown>,
  current: RuntimeConfig
): void {
  if (input.integrations && typeof input.integrations === "object") {
    const integrations = input.integrations as Record<string, unknown>
    if (integrations.steamgriddbApiKey === REDACTED_SENTINEL) {
      integrations.steamgriddbApiKey = current.integrations.steamgriddbApiKey
    }
  }
  if (input.oauthProvider && typeof input.oauthProvider === "object") {
    const provider = input.oauthProvider as Record<string, unknown>
    if (!provider.clientSecret || provider.clientSecret === "") {
      provider.clientSecret = current.oauthProvider?.clientSecret ?? ""
    }
  }
  if (input.storage && typeof input.storage === "object") {
    const storage = input.storage as Record<string, unknown>
    if (storage.fs && typeof storage.fs === "object") {
      const fs = storage.fs as Record<string, unknown>
      if (fs.hmacSecret === REDACTED_SENTINEL) {
        fs.hmacSecret = current.storage.fs.hmacSecret
      }
    }
    if (storage.s3 && typeof storage.s3 === "object") {
      const s3 = storage.s3 as Record<string, unknown>
      if (s3.secretAccessKey === REDACTED_SENTINEL) {
        s3.secretAccessKey = current.storage.s3.secretAccessKey
      }
    }
  }
}

async function selectAdminUserStorageRows(targetUserIds?: string[]): Promise<
  {
    id: string
    name: string
    username: string
    email: string
    image: string | null
    role: string | null
    createdAt: string
    storageQuotaBytes: number | null
    storageUsedBytes: number
  }[]
> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      image: user.image,
      role: user.role,
      createdAt: user.createdAt,
      storageQuotaBytes: user.storageQuotaBytes,
    })
    .from(user)
    .where(targetUserIds ? inArray(user.id, targetUserIds) : undefined)
    .orderBy(desc(user.createdAt))
    .limit(targetUserIds ? targetUserIds.length : 100)

  const usage = await selectSourceStorageUsedBytesByUserIds(
    db,
    rows.map((row) => row.id)
  )

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    storageUsedBytes: usage.get(row.id) ?? 0,
  }))
}

function hasEnabledSignInMethod(config: {
  passkeyEnabled: boolean
  oauthProvider: { enabled: boolean } | null
}): boolean {
  void config.oauthProvider
  return config.passkeyEnabled
}

function sanitizeScopes(scopes: string[] | undefined): string[] | undefined {
  const next = scopes?.map((scope) => scope.trim()).filter(Boolean)
  return next && next.length > 0 ? next : undefined
}

function finalizeOAuthProviderSubmission(
  provider: OAuthProviderAdminSubmission,
  existing: OAuthProviderConfig | null
): OAuthProviderConfig {
  const parsedProvider = OAuthProviderSubmissionSchema.parse({
    ...provider,
    clientId:
      typeof provider.clientId === "string"
        ? provider.clientId.trim()
        : provider.clientId,
    clientSecret:
      typeof provider.clientSecret === "string"
        ? provider.clientSecret.trim()
        : provider.clientSecret,
    scopes: sanitizeScopes(
      Array.isArray(provider.scopes)
        ? provider.scopes.filter(
            (scope): scope is string => typeof scope === "string"
          )
        : undefined
    ),
  })
  const clientSecret =
    parsedProvider.clientSecret.length > 0
      ? parsedProvider.clientSecret
      : existing?.providerId === parsedProvider.providerId
        ? existing.clientSecret
        : ""
  if (clientSecret.length === 0) {
    throw new Error(
      `Client secret is required for ${parsedProvider.displayName}.`
    )
  }
  return OAuthProviderSchema.parse({
    ...parsedProvider,
    clientSecret,
  }) as OAuthProviderConfig
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
    c.header(
      "Content-Disposition",
      'attachment; filename="alloy-config.json"'
    )
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
      configStore.patch(input as Partial<RuntimeConfig>)
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    } catch (cause) {
      return c.json(
        {
          error:
            cause instanceof Error
              ? cause.message
              : "Invalid configuration.",
        },
        400
      )
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
      return c.json(
        {
          error:
            cause instanceof Error ? cause.message : "Couldn't create user.",
        },
        400
      )
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
        return c.json(
          {
            error:
              cause instanceof Error ? cause.message : "Couldn't update role.",
          },
          400
        )
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
      return c.json(
        {
          error:
            cause instanceof Error ? cause.message : "Couldn't remove user.",
        },
        400
      )
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
        return c.json(
          {
            error:
              cause instanceof Error
                ? cause.message
                : "Couldn't save OAuth configuration.",
          },
          400
        )
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
   * `uploadTtlSec` are picked up on the next `/initiate` call;
   * `queueConcurrency` is registered with pg-boss at boot and needs a
   * server restart to take effect (the UI surfaces this as a hint).
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
    const next = structuredClone(current)
    next.driver = patch.driver ?? current.driver
    next.fs = { ...current.fs, ...patch.fs }

    if (patch.s3?.bucket !== undefined) next.s3.bucket = patch.s3.bucket
    if (patch.s3?.region !== undefined) next.s3.region = patch.s3.region
    if (patch.s3?.forcePathStyle !== undefined) {
      next.s3.forcePathStyle = patch.s3.forcePathStyle
    }
    if (patch.s3?.presignExpiresSec !== undefined) {
      next.s3.presignExpiresSec = patch.s3.presignExpiresSec
    }

    if (patch.s3?.endpoint === null) {
      delete next.s3.endpoint
    } else if (patch.s3?.endpoint !== undefined) {
      next.s3.endpoint = patch.s3.endpoint
    }
    if (patch.s3?.accessKeyId === null) {
      delete next.s3.accessKeyId
    } else if (patch.s3?.accessKeyId !== undefined) {
      next.s3.accessKeyId = patch.s3.accessKeyId
    }
    if (
      patch.fs?.hmacSecret === undefined ||
      patch.fs.hmacSecret === REDACTED_SENTINEL
    ) {
      next.fs.hmacSecret = current.fs.hmacSecret
    }
    if (
      patch.s3?.secretAccessKey === undefined ||
      patch.s3.secretAccessKey === REDACTED_SENTINEL
    ) {
      next.s3.secretAccessKey = current.s3.secretAccessKey
    } else if (patch.s3?.secretAccessKey === null) {
      delete next.s3.secretAccessKey
    }

    try {
      configStore.set("storage", next)
    } catch (cause) {
      return c.json(
        {
          error:
            cause instanceof Error
              ? cause.message
              : "Couldn't save storage configuration.",
        },
        400
      )
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
