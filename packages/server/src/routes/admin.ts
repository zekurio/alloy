import {
  HardwareAccelerationSchema,
  OAUTH_TOKEN_AUTH_METHODS,
  RenditionTierConfigSchema,
  VideoCodecSchema,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { withAdminAccessChange } from "@alloy/server/auth/admin-access"
import { requireAdmin } from "@alloy/server/auth/session"
import {
  currentSignInConfig,
  signInConfigError,
} from "@alloy/server/auth/sign-in-config"
import {
  configStore,
  oidcClientSecretAfter,
  prepareConfigSection,
  saveConfigSection,
  saveOidcConfig,
} from "@alloy/server/config/store"
import { probeTranscodingCapabilities } from "@alloy/server/media/capabilities"
import { forceReconcileClipMedia } from "@alloy/server/queue/clip-media-worker"
import { batchProgress, conflict } from "@alloy/server/runtime/http-response"
import { Hono } from "hono"

import { adminGamesRoute } from "./admin-games"
import { adminRuntimeConfigResponse } from "./admin-helpers"
import { adminUsersRoute } from "./admin-users"
import { adminWebhooksRoute } from "./admin-webhooks"
import { tbValidator, validationErrorBody } from "./validation"

// Bodies here only shape the request. Each section's own schema validates
// the merged result, so a body field may be loose.

const RuntimeConfigPatch = t.object({
  setupComplete: t.boolean().optional(),
})

const AuthConfigPatch = t
  .object({
    openRegistrations: t.boolean().optional(),
    passkeyEnabled: t.boolean().optional(),
    requireAuthToBrowse: t.boolean().optional(),
  })
  .refine(
    (patch) =>
      patch.openRegistrations !== undefined ||
      patch.passkeyEnabled !== undefined ||
      patch.requireAuthToBrowse !== undefined,
    { message: "No updates provided" },
  )

// Every field the form edits. A field left out falls back to its default.
// Auth params are left out on purpose: a merged map could never drop a key
// the environment sets, so ALLOY_OIDC_AUTH_PARAMS alone owns them.
const OidcConfigBody = t.object({
  enabled: t.boolean().optional(),
  displayName: t.string().optional(),
  clientId: t.string().optional(),
  issuerUrl: t.string().optional(),
  authorizationUrl: t.string().optional(),
  tokenUrl: t.string().optional(),
  userInfoUrl: t.string().optional(),
  scopes: t.array(t.string()).optional(),
  allowSignUp: t.boolean().optional(),
  pkce: t.boolean().optional(),
  tokenAuthMethod: t.enum(OAUTH_TOKEN_AUTH_METHODS).optional(),
  fetchUserInfo: t.boolean().optional(),
  uidClaim: t.string().optional(),
  usernameClaim: t.string().optional(),
  avatarClaim: t.string().optional(),
  quotaClaim: t.string().optional(),
  roleClaim: t.string().optional(),
  /** Write-only. Absent or empty keeps the secret; null drops the saved one. */
  clientSecret: t.string().nullable().optional(),
})

const TranscodingPatch = t.object({
  videoCodec: VideoCodecSchema.optional(),
  hardwareAcceleration: HardwareAccelerationSchema.optional(),
  vaapiDevice: t.string().optional(),
  quality: t.number().optional(),
  audioBitrateKbps: t.number().optional(),
  tiers: t.array(RenditionTierConfigSchema).optional(),
})

const AccentPatch = t
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((value) => value.toLowerCase())
  .nullable()

const AppearancePatch = t.object({
  loginSplash: t
    .object({
      enabled: t.boolean().optional(),
      blurPx: t.number().optional(),
      darkenOpacity: t.number().optional(),
    })
    .optional(),
  accentColors: t
    .object({ light: AccentPatch.optional(), dark: AccentPatch.optional() })
    .optional(),
})

const UploadLimitsBody = t.object({
  screenshotMaxBytes: t.number().optional(),
  screenshotMaxPixels: t.number().optional(),
  avatarMaxBytes: t.number().optional(),
  bannerMaxBytes: t.number().optional(),
  gameAssetMaxBytes: t.number().optional(),
})

const LimitsBody = t.object({
  defaultStorageQuotaBytes: t.number().nullable().optional(),
  uploadTtlSec: t.number().optional(),
})

export const adminRoute = new Hono()
  .use("*", requireAdmin)
  .route("/", adminUsersRoute)
  .route("/", adminGamesRoute)
  .route("/", adminWebhooksRoute)
  .get("/runtime-config", (c) => {
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .patch(
    "/runtime-config",
    tbValidator("json", RuntimeConfigPatch),
    async (c) => {
      const body = c.req.valid("json")
      if (body.setupComplete !== undefined) {
        await configStore.setSetupComplete(body.setupComplete)
      }
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    },
  )
  .put("/upload-limits", tbValidator("json", UploadLimitsBody), async (c) => {
    const next = prepareConfigSection(
      "uploadLimits",
      c.req.valid("json"),
      "defaults",
    )
    if (!next.success) {
      return c.json(validationErrorBody("json", next.error), 400)
    }
    await saveConfigSection("uploadLimits", next.data)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .put("/limits", tbValidator("json", LimitsBody), async (c) => {
    const next = prepareConfigSection("limits", c.req.valid("json"), "defaults")
    if (!next.success) {
      return c.json(validationErrorBody("json", next.error), 400)
    }
    await saveConfigSection("limits", next.data)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .patch("/auth-config", tbValidator("json", AuthConfigPatch), async (c) => {
    const patch = c.req.valid("json")
    return withAdminAccessChange(async () => {
      // Snapshot, validate, persist, and refresh the process config under the
      // same mutex as every admin-access-removing user transition.
      const next = prepareConfigSection("auth", patch, "current")
      if (!next.success) {
        return c.json(validationErrorBody("json", next.error), 400)
      }
      const error = await signInConfigError({
        ...currentSignInConfig(),
        passkeyEnabled: next.data.passkeyEnabled,
      })
      if (error) return conflict(c, error)

      await saveConfigSection("auth", next.data)
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    })
  })
  .put("/oidc", tbValidator("json", OidcConfigBody), async (c) => {
    const { clientSecret, ...fields } = c.req.valid("json")
    // An empty secret field means "unchanged", like a password form.
    const secretChange =
      clientSecret === null ? null : clientSecret?.trim() || undefined
    return withAdminAccessChange(async () => {
      const next = prepareConfigSection("oidc", fields, "defaults")
      if (!next.success) {
        return c.json(validationErrorBody("json", next.error), 400)
      }
      const error = await signInConfigError({
        passkeyEnabled: configStore.get("passkeyEnabled"),
        oidcUsable:
          next.data.enabled && oidcClientSecretAfter(secretChange) !== "",
      })
      if (error) return conflict(c, error)

      await saveOidcConfig(next.data, secretChange)
      return c.json(adminRuntimeConfigResponse(configStore.getAll()))
    })
  })
  .patch("/appearance", tbValidator("json", AppearancePatch), async (c) => {
    const next = prepareConfigSection(
      "appearance",
      c.req.valid("json"),
      "current",
    )
    if (!next.success) {
      return c.json(validationErrorBody("json", next.error), 400)
    }
    await saveConfigSection("appearance", next.data)
    return c.json(adminRuntimeConfigResponse(configStore.getAll()))
  })
  .patch("/transcoding", tbValidator("json", TranscodingPatch), async (c) => {
    // Ladder rules (distinct tiers, at most one link preview tier) span the
    // merged config, so they are checked on the merged section.
    const next = prepareConfigSection(
      "transcoding",
      c.req.valid("json"),
      "current",
    )
    if (!next.success) {
      return c.json(validationErrorBody("json", next.error), 400)
    }
    await saveConfigSection("transcoding", next.data)
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
    await forceReconcileClipMedia()
    return batchProgress(c, "enqueued", 1, false)
  })
