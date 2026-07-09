import {
  HardwareAccelerationSchema,
  RenditionTierConfigSchema,
  VideoCodecSchema,
} from "@alloy/contracts"
import { requireAdmin } from "@alloy/server/auth/session"
import { signInConfigError } from "@alloy/server/auth/sign-in-config"
import {
  OAuthProviderSubmissionSchema,
  type OAuthProviderSubmission,
} from "@alloy/server/config/oauth-schema"
import {
  authEnvLocks,
  configStore,
  setAuthToggles,
  setOAuthProviders,
} from "@alloy/server/config/store"
import { enqueueRenditionsSweep } from "@alloy/server/jobs/kinds/renditions-sweep"
import { enqueueStorageVerify } from "@alloy/server/jobs/kinds/storage-verify"
import { probeTranscodingCapabilities } from "@alloy/server/media/capabilities"
import {
  badRequest,
  batchProgress,
  conflict,
} from "@alloy/server/runtime/http-response"
import { Hono } from "hono"
import { z } from "zod"

import { adminGamesRoute } from "./admin-games"
import { adminRuntimeConfigResponse } from "./admin-helpers"
import { adminJobsRoute } from "./admin-jobs"
import { adminUsersRoute } from "./admin-users"
import { zValidator } from "./validation"

const RuntimeConfigPatch = z.object({
  setupComplete: z.boolean().optional(),
})

const AuthConfigPatch = z
  .object({
    openRegistrations: z.boolean().optional(),
    passkeyEnabled: z.boolean().optional(),
    requireAuthToBrowse: z.boolean().optional(),
  })
  .refine(
    (patch) =>
      patch.openRegistrations !== undefined ||
      patch.passkeyEnabled !== undefined ||
      patch.requireAuthToBrowse !== undefined,
    { message: "No updates provided" },
  )

// Mirrors OAuthProvidersSchema's array-level constraints for the submission
// shape (write-only clientSecret per provider).
const OAuthProvidersBody = z.object({
  providers: z
    .array(OAuthProviderSubmissionSchema)
    .max(16)
    .superRefine((providers, ctx) => {
      const seen = new Set<string>()
      for (const [index, provider] of providers.entries()) {
        if (!seen.has(provider.providerId)) {
          seen.add(provider.providerId)
          continue
        }
        ctx.addIssue({
          code: "custom",
          path: [index, "providerId"],
          message: "Provider ID must be unique.",
        })
      }
    }),
})

const TranscodingPatch = z.object({
  videoCodec: VideoCodecSchema.optional(),
  hardwareAcceleration: HardwareAccelerationSchema.optional(),
  vaapiDevice: z.string().trim().min(1).optional(),
  quality: z.number().int().min(10).max(51).optional(),
  audioBitrateKbps: z.number().int().min(64).max(320).optional(),
  tiers: z.array(RenditionTierConfigSchema).min(1).max(6).optional(),
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

export const adminRoute = new Hono()
  .use("*", requireAdmin)
  .route("/", adminUsersRoute)
  .route("/", adminGamesRoute)
  .route("/", adminJobsRoute)
  .get("/runtime-config", (c) => {
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .patch(
    "/runtime-config",
    zValidator("json", RuntimeConfigPatch),
    async (c) => {
      const body = c.req.valid("json")
      if (body.setupComplete !== undefined) {
        await configStore.set("setupComplete", body.setupComplete)
      }
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    },
  )
  .patch("/auth-config", zValidator("json", AuthConfigPatch), async (c) => {
    const patch = c.req.valid("json")
    const locks = authEnvLocks()
    for (const key of [
      "openRegistrations",
      "passkeyEnabled",
      "requireAuthToBrowse",
    ] as const) {
      if (patch[key] !== undefined && locks[key]) {
        return badRequest(
          c,
          "This setting is env-managed. Unset its ALLOY_* environment variable to edit it here.",
        )
      }
    }

    // Turning passkeys off must leave a usable sign-in method (and one an
    // active admin can actually use) — same lockout guard as provider edits.
    if (patch.passkeyEnabled === false) {
      const error = await signInConfigError({
        passkeyEnabled: false,
        oauthProviders: configStore.get("oauthProviders"),
      })
      if (error) return conflict(c, error)
    }

    await setAuthToggles(patch)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .put(
    "/oauth-providers",
    zValidator("json", OAuthProvidersBody),
    async (c) => {
      if (authEnvLocks().oauthProviders) {
        return badRequest(
          c,
          "OAuth providers are managed by the ALLOY_SOCIALACCOUNT_PROVIDERS environment variable. Unset it to edit providers here.",
        )
      }

      const submissions = c.req.valid("json").providers
      // Non-empty submitted secrets become the new stored secret; absent or
      // empty keeps the provider's existing one (write-only semantics).
      const newSecrets: Record<string, string> = {}
      for (const submission of submissions) {
        const secret = submission.clientSecret?.trim()
        if (secret) newSecrets[submission.providerId] = secret
      }
      const providers = submissions.map(
        ({
          clientSecret: _clientSecret,
          ...provider
        }: OAuthProviderSubmission) => provider,
      )

      const error = await signInConfigError(
        {
          passkeyEnabled: configStore.get("passkeyEnabled"),
          oauthProviders: providers,
        },
        (providerId) => Object.hasOwn(newSecrets, providerId),
      )
      if (error) return conflict(c, error)

      await setOAuthProviders(providers, newSecrets)
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
    await configStore.set("appearance", next)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .patch("/transcoding", zValidator("json", TranscodingPatch), async (c) => {
    const patch = c.req.valid("json")
    // TranscodingConfigSchema rejects an all-disabled ladder inside set().
    await configStore.set("transcoding", {
      ...configStore.get("transcoding"),
      ...patch,
    })
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .get("/transcoding/capabilities", async (c) => {
    return c.json(
      await probeTranscodingCapabilities({
        refresh: c.req.query("refresh") === "true",
        vaapiDevice: configStore.get("transcoding").vaapiDevice,
      }),
    )
  })
  .post("/clips/re-encode", async (c) => {
    await enqueueRenditionsSweep("force", { runAt: new Date() })
    return batchProgress(c, "enqueued", 1, false)
  })
  .post("/clips/verify-storage", async (c) => {
    await enqueueStorageVerify({ runAt: new Date() })
    return batchProgress(c, "enqueued", 1, false)
  })
