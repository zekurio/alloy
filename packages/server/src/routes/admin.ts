import { clip } from "@alloy/db/schema"
import { requireAdmin } from "@alloy/server/auth/session"
import { signInConfigError } from "@alloy/server/auth/sign-in-config"
import { OAuthProvidersSchema } from "@alloy/server/config/oauth-schema"
import {
  IntegrationsSecretPatchSchema,
  LimitsConfigPatchSchema,
  StorageConfigPatchSchema,
} from "@alloy/server/config/schema"
import {
  isOAuthProviderUsable,
  secretStore,
} from "@alloy/server/config/secret-store"
import { configStore, parseRuntimeConfig } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { enqueueClipMediaProcessing } from "@alloy/server/queue/index"
import {
  badRequest,
  badRequestFromCause,
  batchProgress,
} from "@alloy/server/runtime/http-response"
import { inArray } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import {
  adminRuntimeConfigResponse,
  finalizeOAuthProviderSubmission,
} from "./admin-helpers"
import { adminScheduledTasksRoute } from "./admin-scheduled-tasks"
import { adminUsersRoute } from "./admin-users"
import { zValidator } from "./validation"

const RE_ENCODE_BATCH_LIMIT = 100

const RuntimeConfigPatch = z.object({
  setupComplete: z.boolean().optional(),
  openRegistrations: z.boolean().optional(),
  passkeyEnabled: z.boolean().optional(),
  requireAuthToBrowse: z.boolean().optional(),
})

const AppearancePatch = z.object({
  loginSplash: z
    .object({
      enabled: z.boolean().optional(),
      blurPx: z.number().min(0).max(48).optional(),
      darkenOpacity: z.number().min(0).max(1).optional(),
    })
    .optional(),
})

const OAuthProviderAdminSubmissionSchema = z
  .object({
    providerId: z.string().optional(),
  })
  .passthrough()

const OAuthConfigSubmissionSchema = z.object({
  oauthProviders: z.array(OAuthProviderAdminSubmissionSchema).max(16),
})

export const adminRoute = new Hono()
  .use("*", requireAdmin)
  .route("/", adminUsersRoute)
  .get("/runtime-config", (c) => {
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .post("/runtime-config/reload", async (c) => {
    if (!(await configStore.reload())) {
      return badRequest(c, "Runtime config file failed validation.")
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
      return badRequest(c, "Invalid JSON.")
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return badRequest(c, "Expected a JSON object.")
    }
    const input = body as Record<string, unknown>
    try {
      const next = parseRuntimeConfig(input)
      const nextProviderIds = new Set(
        next.oauthProviders.map((provider) => provider.providerId),
      )

      const authError = await signInConfigError(next)
      if (authError) {
        return badRequest(c, authError)
      }

      configStore.replace(next)
      secretStore.update({
        retainOAuth: nextProviderIds,
      })
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    } catch (cause) {
      return badRequestFromCause(c, cause, "Invalid configuration.")
    }
  })
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
      const authError = await signInConfigError(next)
      if (authError) {
        return badRequest(c, authError)
      }
      const patch: Partial<{
        setupComplete: boolean
        openRegistrations: boolean
        passkeyEnabled: boolean
        requireAuthToBrowse: boolean
      }> = {}
      if (body.setupComplete !== undefined) {
        patch.setupComplete = body.setupComplete
      }
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
    },
  )
  .put(
    "/oauth-config",
    zValidator("json", OAuthConfigSubmissionSchema),
    async (c) => {
      const submission = c.req.valid("json")
      try {
        const finalized = submission.oauthProviders.map(
          finalizeOAuthProviderSubmission,
        )
        const nextProviders = OAuthProvidersSchema.parse(
          finalized.map((entry) => entry.provider),
        )
        const newSecrets: Record<string, string> = {}
        for (const entry of finalized) {
          if (entry.newClientSecret !== undefined) {
            newSecrets[entry.provider.providerId] = entry.newClientSecret
          }
        }
        const hasPendingSecret = (providerId: string) =>
          providerId in newSecrets
        // UX guard: enabling a provider requires a secret (new or already
        // stored) so the admin gets immediate feedback rather than a silently
        // non-functional button.
        for (const entry of finalized) {
          if (
            entry.provider.enabled &&
            !isOAuthProviderUsable(entry.provider, hasPendingSecret)
          ) {
            return badRequest(
              c,
              `Client secret is required for ${entry.provider.displayName}.`,
            )
          }
        }
        const authError = await signInConfigError(
          {
            passkeyEnabled: configStore.get("passkeyEnabled"),
            oauthProviders: nextProviders,
          },
          hasPendingSecret,
        )
        if (authError) {
          return badRequest(c, authError)
        }
        configStore.patch({ oauthProviders: nextProviders })
        // Single write: prune removed providers' secrets, overlay the new ones.
        secretStore.update({
          setOAuth: newSecrets,
          retainOAuth: nextProviders.map((provider) => provider.providerId),
        })
      } catch (cause) {
        return badRequestFromCause(
          c,
          cause,
          "Couldn't save OAuth configuration.",
        )
      }
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    },
  )
  /**
   * PATCH /limits — update quota defaults and ticket lifetime. `uploadTtlSec`
   * is picked up on the next `/initiate` call.
   */
  .patch("/limits", zValidator("json", LimitsConfigPatchSchema), (c) => {
    const patch = c.req.valid("json")
    const next = { ...configStore.get("limits"), ...patch }
    configStore.set("limits", next)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .patch("/storage", zValidator("json", StorageConfigPatchSchema), (c) => {
    const patch = c.req.valid("json")
    const current = configStore.get("storage")
    const {
      s3AccessKeyId,
      s3SecretAccessKey,
      s3: s3Patch,
      ...storagePatch
    } = patch

    const next = {
      ...current,
      ...storagePatch,
      s3: {
        ...current.s3,
        ...s3Patch,
      },
    }
    const currentCredentials = secretStore.storageS3Credentials()
    const nextAccessKeyId =
      s3AccessKeyId !== undefined
        ? s3AccessKeyId.trim()
        : (currentCredentials?.accessKeyId ?? "")
    const nextSecretAccessKey =
      s3SecretAccessKey !== undefined
        ? s3SecretAccessKey.trim()
        : (currentCredentials?.secretAccessKey ?? "")

    if (next.driver === "s3") {
      if (!next.s3.bucket.trim()) return badRequest(c, "S3 bucket is required.")
      if (!next.s3.region.trim()) return badRequest(c, "S3 region is required.")
      if (!nextAccessKeyId) {
        return badRequest(c, "S3 access key ID is required.")
      }
      if (!nextSecretAccessKey) {
        return badRequest(c, "S3 secret access key is required.")
      }
    }

    if (s3AccessKeyId !== undefined || s3SecretAccessKey !== undefined) {
      secretStore.setStorageS3Credentials({
        accessKeyId:
          s3AccessKeyId !== undefined ? s3AccessKeyId.trim() : undefined,
        secretAccessKey:
          s3SecretAccessKey !== undefined
            ? s3SecretAccessKey.trim()
            : undefined,
      })
    }
    configStore.set("storage", next)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .patch(
    "/integrations",
    zValidator("json", IntegrationsSecretPatchSchema),
    (c) => {
      const patch = c.req.valid("json")
      // The SteamGridDB key is a secret; an empty string clears it. Absent
      // means "leave unchanged".
      if (patch.steamgriddbApiKey !== undefined) {
        secretStore.setSteamgriddbApiKey(patch.steamgriddbApiKey.trim())
      }
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    },
  )
  .patch("/appearance", zValidator("json", AppearancePatch), async (c) => {
    const patch = c.req.valid("json")
    const current = configStore.get("appearance")
    const next = { ...current, loginSplash: { ...current.loginSplash } }
    if (patch.loginSplash?.enabled !== undefined) {
      next.loginSplash.enabled = patch.loginSplash.enabled
    }
    if (patch.loginSplash?.blurPx !== undefined) {
      next.loginSplash.blurPx = patch.loginSplash.blurPx
    }
    if (patch.loginSplash?.darkenOpacity !== undefined) {
      next.loginSplash.darkenOpacity = patch.loginSplash.darkenOpacity
    }
    configStore.set("appearance", next)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .route("/scheduled-tasks", adminScheduledTasksRoute)
  .post("/clips/re-encode", async (c) => {
    const rows = await db
      .select({ id: clip.id })
      .from(clip)
      .where(inArray(clip.status, ["ready", "failed"]))
      .orderBy(clip.createdAt)
      .limit(RE_ENCODE_BATCH_LIMIT + 1)
    const batch = rows.slice(0, RE_ENCODE_BATCH_LIMIT)
    if (batch.length === 0) {
      return batchProgress(c, "enqueued", 0, false)
    }
    const ids = batch.map((r) => r.id)
    await db
      .update(clip)
      .set({
        status: "processing",
        encodeProgress: 0,
        encodeRunId: null,
        encodeLockedAt: null,
        encodeAttempt: 0,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(inArray(clip.id, ids))

    for (const id of ids) {
      enqueueClipMediaProcessing(id)
    }
    return batchProgress(
      c,
      "enqueued",
      ids.length,
      rows.length > RE_ENCODE_BATCH_LIMIT,
    )
  })
