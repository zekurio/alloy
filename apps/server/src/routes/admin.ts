import { spawn } from "node:child_process"

import { zValidator } from "@hono/zod-validator"
import { inArray } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import { clip } from "@workspace/db/schema"

import { getAuth } from "../auth"
import { db } from "../db"
import { env } from "../env"
import {
  EncoderConfigPatchSchema,
  HWACCEL_KINDS,
  IntegrationsConfigPatchSchema,
  LimitsConfigPatchSchema,
  OAuthProviderSubmissionSchema,
  configStore,
  type HwaccelKind,
  type RuntimeConfig,
} from "../lib/config-store"
import { ENCODE_JOB, getBoss } from "../queue"
import { codecNameFor } from "../queue/ffmpeg"

const requireAdmin = createMiddleware<{
  Variables: { adminUserId: string }
}>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  const role = (session.user as { role?: string }).role
  if (role !== "admin") {
    return c.json({ error: "Forbidden" }, 403)
  }
  c.set("adminUserId", session.user.id)
  await next()
})

const RuntimeConfigPatch = z.object({
  openRegistrations: z.boolean().optional(),
  emailPasswordEnabled: z.boolean().optional(),
  requireAuthToBrowse: z.boolean().optional(),
})

const REDACTED_SENTINEL = "***"

function redactSecrets(
  config: Readonly<RuntimeConfig>
): Readonly<RuntimeConfig> {
  const next: RuntimeConfig = {
    ...config,
    integrations: {
      ...config.integrations,
      steamgriddbApiKey: config.integrations.steamgriddbApiKey
        ? REDACTED_SENTINEL
        : "",
    },
  }
  if (next.oauthProvider) {
    next.oauthProvider = { ...next.oauthProvider, clientSecret: "" }
  }
  return next
}

export const adminRoute = new Hono()
  .use("*", requireAdmin)
  .get("/runtime-config", (c) => {
    return c.json(redactSecrets(configStore.getAll()))
  })
  .patch("/runtime-config", zValidator("json", RuntimeConfigPatch), (c) => {
    const body = c.req.valid("json")
    // Refuse to disable the only remaining sign-in surface — without an
    // OAuth provider configured, turning email/password off would lock
    // every existing user (admins included) out of the app.
    if (
      body.emailPasswordEnabled === false &&
      configStore.get("oauthProvider") === null
    ) {
      return c.json(
        {
          error:
            "Configure an OAuth provider before disabling email/password — otherwise no one can sign in.",
        },
        400
      )
    }
    const patch: Partial<{
      openRegistrations: boolean
      emailPasswordEnabled: boolean
      requireAuthToBrowse: boolean
    }> = {}
    if (body.openRegistrations !== undefined) {
      patch.openRegistrations = body.openRegistrations
    }
    if (body.emailPasswordEnabled !== undefined) {
      patch.emailPasswordEnabled = body.emailPasswordEnabled
    }
    if (body.requireAuthToBrowse !== undefined) {
      patch.requireAuthToBrowse = body.requireAuthToBrowse
    }
    if (Object.keys(patch).length > 0) configStore.patch(patch)
    return c.json(redactSecrets(configStore.getAll()))
  })
  .put(
    "/oauth-provider",
    zValidator("json", OAuthProviderSubmissionSchema),
    (c) => {
      const submission = c.req.valid("json")
      const existing = configStore.get("oauthProvider")
      const clientSecret =
        submission.clientSecret.length > 0
          ? submission.clientSecret
          : (existing?.clientSecret ?? "")
      if (clientSecret.length === 0) {
        return c.json(
          { error: "clientSecret is required when no provider is configured." },
          400
        )
      }
      configStore.set("oauthProvider", { ...submission, clientSecret })
      return c.json(redactSecrets(configStore.getAll()))
    }
  )
  .delete("/oauth-provider", (c) => {
    // Same lockout guard as the runtime-config patch: don't let the admin
    if (!configStore.get("emailPasswordEnabled")) {
      return c.json(
        {
          error:
            "Re-enable email/password login before removing the OAuth provider — otherwise no one can sign in.",
        },
        400
      )
    }
    configStore.set("oauthProvider", null)
    return c.json(redactSecrets(configStore.getAll()))
  })

  /**
   * PATCH /encoder — update the encoder profile (hwaccel/codec/quality/
   * preset/targetHeight/audioBitrate/vaapiDevice). Partial — admins
   * usually flip one knob at a time. Changes apply to the *next* encode
   * job; jobs already running finish on the previous config.
   */
  .patch("/encoder", zValidator("json", EncoderConfigPatchSchema), (c) => {
    const patch = c.req.valid("json")
    const next = { ...configStore.get("encoder"), ...patch }
    configStore.set("encoder", next)
    return c.json(redactSecrets(configStore.getAll()))
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
    return c.json(redactSecrets(configStore.getAll()))
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
      return c.json(redactSecrets(configStore.getAll()))
    }
  )

  .get("/encoder/capabilities", async (c) => {
    return c.json(await getEncoderCapabilities())
  })

  .post("/clips/re-encode", async (c) => {
    const rows = await db
      .select({ id: clip.id })
      .from(clip)
      .where(inArray(clip.status, ["ready", "failed"]))
    if (rows.length === 0) {
      return c.json({ enqueued: 0 })
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
    // pg-boss doesn't have a bulk-send that honours the same retry
    // policy; sequentially `send()`-ing keeps each job's metadata
    // independent (retryCount, expireInSeconds) without bouncing through
    // a different insert path.
    for (const id of ids) {
      await boss.send(ENCODE_JOB, { clipId: id })
    }
    return c.json({ enqueued: ids.length })
  })

let capabilityCache: {
  expiresAt: number
  value: EncoderCapabilities
} | null = null

interface EncoderCapabilities {
  ffmpegOk: boolean
  /** ffmpeg's `-version` first line, or null if the probe failed. */
  ffmpegVersion: string | null
  available: Record<HwaccelKind, { h264: boolean; hevc: boolean; av1: boolean }>
}

async function getEncoderCapabilities(): Promise<EncoderCapabilities> {
  if (capabilityCache && capabilityCache.expiresAt > Date.now()) {
    return capabilityCache.value
  }
  const value = await probeEncoderCapabilities()
  capabilityCache = { value, expiresAt: Date.now() + 5 * 60_000 }
  return value
}

async function probeEncoderCapabilities(): Promise<EncoderCapabilities> {
  const empty: EncoderCapabilities["available"] = {
    software: { h264: false, hevc: false, av1: false },
    nvenc: { h264: false, hevc: false, av1: false },
    qsv: { h264: false, hevc: false, av1: false },
    amf: { h264: false, hevc: false, av1: false },
    vaapi: { h264: false, hevc: false, av1: false },
  }

  const stdout = await runCapture(env.FFMPEG_BIN, [
    "-hide_banner",
    "-encoders",
  ]).catch(() => null)
  if (!stdout) return { ffmpegOk: false, ffmpegVersion: null, available: empty }

  const names = new Set<string>()
  for (const line of stdout.split("\n")) {
    const m = /^\s[A-Z.]{6}\s+(\S+)/.exec(line)
    if (m && m[1]) names.add(m[1])
  }

  const available = { ...empty }
  for (const hw of HWACCEL_KINDS) {
    available[hw] = {
      h264: names.has(codecNameFor(hw, "h264")),
      hevc: names.has(codecNameFor(hw, "hevc")),
      av1: names.has(codecNameFor(hw, "av1")),
    }
  }

  // Best-effort version string — if `-version` fails we still return
  // the encoder matrix above (we already know ffmpeg is present).
  const versionStdout = await runCapture(env.FFMPEG_BIN, [
    "-hide_banner",
    "-version",
  ]).catch(() => null)
  const ffmpegVersion = versionStdout
    ? (versionStdout.split("\n")[0] ?? "").trim() || null
    : null

  return { ffmpegOk: true, ffmpegVersion, available }
}

function runCapture(bin: string, args: ReadonlyArray<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin} exited ${code}`))
    })
  })
}
