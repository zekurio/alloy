import { spawn } from "node:child_process"

import { zValidator } from "@hono/zod-validator"
import { desc, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import type { AdminEncoderCapabilities as EncoderCapabilities } from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"

import { getAuth } from "../auth"
import { db } from "../db"
import { env } from "../env"
import {
  EncoderConfigPatchSchema,
  HWACCEL_KINDS,
  IntegrationsConfigPatchSchema,
  LimitsConfigPatchSchema,
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
  configStore,
  type OAuthProviderConfig,
  type RuntimeConfig,
} from "../lib/config-store"
import { selectSourceStorageUsedBytesByUserIds } from "../lib/storage-quota"
import { ENCODE_JOB, getBoss } from "../queue"
import { codecNameFor } from "../queue/ffmpeg"

const RE_ENCODE_BATCH_LIMIT = 100

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
  }
}

function adminRuntimeConfigResponse(config: Readonly<RuntimeConfig>) {
  return {
    ...redactSecrets(config),
    authBaseURL: env.PUBLIC_SERVER_URL,
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
    banned: boolean | null
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
      banned: user.banned,
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
    banned: row.banned ?? null,
    createdAt: row.createdAt.toISOString(),
    storageUsedBytes: usage.get(row.id) ?? 0,
  }))
}

function hasEnabledOAuthProvider(config: {
  oauthProvider: { enabled: boolean } | null
}): boolean {
  return config.oauthProvider?.enabled === true
}

function hasEnabledSignInMethod(config: {
  passkeyEnabled: boolean
  oauthProvider: { enabled: boolean } | null
}): boolean {
  return config.passkeyEnabled || hasEnabledOAuthProvider(config)
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
  .get("/users", async (c) => {
    return c.json({ users: await selectAdminUserStorageRows() })
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

let capabilityCache: {
  expiresAt: number
  value: EncoderCapabilities
} | null = null

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
    none: { h264: false, hevc: false, av1: false },
    amf: { h264: false, hevc: false, av1: false },
    nvenc: { h264: false, hevc: false, av1: false },
    qsv: { h264: false, hevc: false, av1: false },
    rkmpp: { h264: false, hevc: false, av1: false },
    vaapi: { h264: false, hevc: false, av1: false },
    videotoolbox: { h264: false, hevc: false, av1: false },
    v4l2m2m: { h264: false, hevc: false, av1: false },
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
