import { ACCEPTED_IMAGE_CONTENT_TYPES } from "alloy-contracts"
import { clip } from "alloy-db/schema"
import { inArray } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { requireAdmin } from "../auth/session"
import { signInConfigError } from "../auth/sign-in-config"
import { isOAuthProviderUsable, secretStore } from "../config/secret-store"
import {
  configStore,
  EncoderConfigPatchSchema,
  IntegrationsSecretPatchSchema,
  LimitsConfigPatchSchema,
  MachineLearningConfigPatchSchema,
  OAuthProvidersSchema,
  parseRuntimeConfig,
} from "../config/store"
import { db } from "../db"
import { enqueueEncode } from "../queue"
import {
  badRequest,
  badRequestFromCause,
  batchProgress,
} from "../runtime/http-response"
import {
  ensureLoginSplashImage,
  generateLoginSplashPatch,
  storeUploadedLoginSplashImage,
} from "./admin-appearance"
import {
  clearEncoderCapabilitiesCache,
  getEncoderCapabilities,
} from "./admin-encoder-capabilities"
import {
  adminRuntimeConfigResponse,
  finalizeOAuthProviderSubmission,
} from "./admin-helpers"
import { adminUsersRoute } from "./admin-users"
import { zValidator } from "./validation"

const RE_ENCODE_BATCH_LIMIT = 100
const MAX_LOGIN_SPLASH_UPLOAD_BYTES = 12 * 1024 * 1024

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

const LoginSplashUploadForm = z.object({
  file: z
    .instanceof(File, { message: "Expected an uploaded image file" })
    .refine((file) => file.size > 0, "Image file is empty")
    .refine(
      (file) => file.size <= MAX_LOGIN_SPLASH_UPLOAD_BYTES,
      "Login backdrop must be 12 MB or smaller",
    )
    .refine(
      (file) =>
        (ACCEPTED_IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type),
      "Unsupported image type",
    ),
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
    clearEncoderCapabilitiesCache()
    if (configStore.get("appearance").loginSplash.enabled) {
      await ensureLoginSplashImage()
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
      clearEncoderCapabilitiesCache()
      secretStore.update({
        retainOAuth: nextProviderIds,
      })
      if (next.appearance.loginSplash.enabled) await ensureLoginSplashImage()
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
   * PATCH /encoder — update live transcoding settings. Partial — admins
   * usually flip one knob at a time. Changes apply to future live transcodes;
   * already running processes finish on the previous config.
   */
  .patch("/encoder", zValidator("json", EncoderConfigPatchSchema), (c) => {
    const patch = c.req.valid("json")
    const current = configStore.get("encoder")
    const next = {
      ...current,
      ...patch,
      tonemapping: {
        ...current.tonemapping,
        ...patch.tonemapping,
        vpp: {
          ...current.tonemapping.vpp,
          ...patch.tonemapping?.vpp,
        },
      },
    }
    configStore.set("encoder", next)
    clearEncoderCapabilitiesCache()
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  /**
   * PATCH /limits — update upload limits. `maxUploadBytes` and `uploadTtlSec`
   * are picked up on the next `/initiate` call.
   */
  .patch("/limits", zValidator("json", LimitsConfigPatchSchema), (c) => {
    const patch = c.req.valid("json")
    const next = { ...configStore.get("limits"), ...patch }
    configStore.set("limits", next)
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
  .patch(
    "/machine-learning",
    zValidator("json", MachineLearningConfigPatchSchema),
    (c) => {
      const patch = c.req.valid("json")
      const current = configStore.get("machineLearning")
      const next = {
        ...current,
        ...patch,
        gameClassifier: {
          ...current.gameClassifier,
          ...patch.gameClassifier,
        },
      }
      configStore.set("machineLearning", next)
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
    // Enabling the backdrop only flips the flag; make sure a renderable image
    // exists so /api/auth-config doesn't report it enabled with nothing to show.
    // No-op when already present (and when disabled).
    if (next.loginSplash.enabled) await ensureLoginSplashImage()
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .post("/appearance/login-splash/regenerate", async (c) => {
    const current = configStore.get("appearance")
    configStore.set("appearance", {
      ...current,
      loginSplash: await generateLoginSplashPatch(
        current.loginSplash.enabled,
        current.loginSplash,
      ),
    })
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .post(
    "/appearance/login-splash/upload",
    zValidator("form", LoginSplashUploadForm),
    async (c) => {
      const { file } = c.req.valid("form")
      const current = configStore.get("appearance")
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await storeUploadedLoginSplashImage({ bytes, contentType: file.type })
      } catch (cause) {
        return badRequestFromCause(c, cause, "Couldn't upload login backdrop.")
      }
      configStore.set("appearance", {
        ...current,
        loginSplash: { ...current.loginSplash, enabled: true },
      })
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    },
  )
  .get("/encoder/capabilities", async (c) => {
    return c.json(await getEncoderCapabilities())
  })
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
      enqueueEncode(id)
    }
    return batchProgress(
      c,
      "enqueued",
      ids.length,
      rows.length > RE_ENCODE_BATCH_LIMIT,
    )
  })
