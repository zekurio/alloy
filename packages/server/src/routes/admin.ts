import {
  HardwareAccelerationSchema,
  RenditionTierConfigSchema,
  VideoCodecSchema,
} from "@alloy/contracts"
import { requireAdmin } from "@alloy/server/auth/session"
import { configStore } from "@alloy/server/config/store"
import { enqueueRenditionsSweep } from "@alloy/server/jobs/kinds/renditions-sweep"
import { enqueueStorageVerify } from "@alloy/server/jobs/kinds/storage-verify"
import { probeTranscodingCapabilities } from "@alloy/server/media/capabilities"
import { batchProgress } from "@alloy/server/runtime/http-response"
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
