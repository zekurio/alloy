import { spawn } from "node:child_process"

import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import { getAuth } from "../auth"
import { env } from "../env"
import {
  EncoderConfigPatchSchema,
  HWACCEL_KINDS,
  LimitsConfigPatchSchema,
  OAuthProviderSubmissionSchema,
  configStore,
  type HwaccelKind,
  type RuntimeConfig,
} from "../lib/config-store"
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
})

/**
 * Strip the client secret before handing the config to the admin UI.
 * Admins re-enter it on every save — same pattern as GitHub Actions secrets.
 */
function redactOAuthProvider(
  config: Readonly<RuntimeConfig>
): Readonly<RuntimeConfig> {
  if (!config.oauthProvider) return config
  return {
    ...config,
    oauthProvider: { ...config.oauthProvider, clientSecret: "" },
  }
}

export const adminRoute = new Hono()
  .use("*", requireAdmin)
  .get("/runtime-config", (c) => {
    return c.json(redactOAuthProvider(configStore.getAll()))
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
    }> = {}
    if (body.openRegistrations !== undefined) {
      patch.openRegistrations = body.openRegistrations
    }
    if (body.emailPasswordEnabled !== undefined) {
      patch.emailPasswordEnabled = body.emailPasswordEnabled
    }
    if (Object.keys(patch).length > 0) configStore.patch(patch)
    return c.json(redactOAuthProvider(configStore.getAll()))
  })
  // PUT replaces the provider wholesale; DELETE clears it. An empty
  // `clientSecret` in the submission means "keep the existing secret" —
  // lets admins tweak settings without re-entering a rotated secret.
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
      return c.json(redactOAuthProvider(configStore.getAll()))
    }
  )
  .delete("/oauth-provider", (c) => {
    // Same lockout guard as the runtime-config patch: don't let the admin
    // remove the only remaining sign-in surface.
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
    return c.json(redactOAuthProvider(configStore.getAll()))
  })

  /**
   * PATCH /encoder — update the encoder profile (hwaccel/codec/quality/
   * preset/targetHeight/audioBitrate/vaapiDevice). Partial — admins
   * usually flip one knob at a time. Changes apply to the *next* encode
   * job; jobs already running finish on the previous config.
   */
  .patch(
    "/encoder",
    zValidator("json", EncoderConfigPatchSchema),
    (c) => {
      const patch = c.req.valid("json")
      const next = { ...configStore.get("encoder"), ...patch }
      configStore.set("encoder", next)
      return c.json(redactOAuthProvider(configStore.getAll()))
    }
  )

  /**
   * PATCH /limits — update upload + queue limits. `maxUploadBytes` and
   * `uploadTtlSec` are picked up on the next `/initiate` call;
   * `queueConcurrency` is registered with pg-boss at boot and needs a
   * server restart to take effect (the UI surfaces this as a hint).
   */
  .patch(
    "/limits",
    zValidator("json", LimitsConfigPatchSchema),
    (c) => {
      const patch = c.req.valid("json")
      const next = { ...configStore.get("limits"), ...patch }
      configStore.set("limits", next)
      return c.json(redactOAuthProvider(configStore.getAll()))
    }
  )

  /**
   * GET /encoder/capabilities — probe ffmpeg for which encoder names
   * it knows about. Lets the admin UI grey out backends the binary
   * wasn't compiled with (no `h264_nvenc` if there's no NVENC support,
   * etc.) instead of letting admins pick one and watch every encode
   * fail with the same cryptic "Unknown encoder" error.
   *
   * Result is cached for 5 minutes so flipping between encoder backends
   * in the UI doesn't shell out on every keystroke. Cache busts on
   * server restart, which is when binary changes happen anyway.
   */
  .get("/encoder/capabilities", async (c) => {
    return c.json(await getEncoderCapabilities())
  })

let capabilityCache: {
  expiresAt: number
  value: EncoderCapabilities
} | null = null

interface EncoderCapabilities {
  ffmpegOk: boolean
  /** ffmpeg's `-version` first line, or null if the probe failed. */
  ffmpegVersion: string | null
  /**
   * Per-(hwaccel, codec) availability. `available[kind][codec]` is true
   * when the corresponding ffmpeg encoder name shows up in `-encoders`.
   * Software always reports true if ffmpeg is present (libx264/x265 are
   * compiled into virtually every modern build).
   */
  available: Record<HwaccelKind, { h264: boolean; hevc: boolean }>
}

async function getEncoderCapabilities(): Promise<EncoderCapabilities> {
  if (capabilityCache && capabilityCache.expiresAt > Date.now()) {
    return capabilityCache.value
  }
  const value = await probeEncoderCapabilities()
  capabilityCache = { value, expiresAt: Date.now() + 5 * 60_000 }
  return value
}

/**
 * Run `ffmpeg -hide_banner -encoders` and grep the output for the names
 * `codecNameFor()` would emit per (hwaccel, codec) pair. Resolves with
 * an all-false matrix (and `ffmpegOk = false`) on any spawn failure so
 * the admin UI degrades gracefully when ffmpeg is missing.
 */
async function probeEncoderCapabilities(): Promise<EncoderCapabilities> {
  const empty: EncoderCapabilities["available"] = {
    software: { h264: false, hevc: false },
    nvenc: { h264: false, hevc: false },
    qsv: { h264: false, hevc: false },
    amf: { h264: false, hevc: false },
    vaapi: { h264: false, hevc: false },
  }

  const stdout = await runCapture(env.FFMPEG_BIN, [
    "-hide_banner",
    "-encoders",
  ]).catch(() => null)
  if (!stdout) return { ffmpegOk: false, ffmpegVersion: null, available: empty }

  // `-encoders` lists one encoder per line; the name is the second
  // whitespace-separated token. We don't need to parse the flags column —
  // presence in the list is enough.
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
