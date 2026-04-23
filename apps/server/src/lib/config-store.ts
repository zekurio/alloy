import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

import {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  type EncoderHwaccel,
  type RuntimeConfig,
} from "@workspace/db/contracts"
import { env } from "../env"

const ProviderIdPattern = /^[a-z0-9-]+$/

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HEIGHT_SUGGESTIONS,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/db/contracts"
export const HWACCEL_KINDS = ENCODER_HWACCELS
export type HwaccelKind = EncoderHwaccel
export type { UsernameClaim } from "@workspace/db/contracts"

const OAuthProviderBaseSchema = z.object({
  providerId: z
    .string()
    .min(1)
    .max(64)
    .regex(ProviderIdPattern, "lowercase letters, digits, and dashes only"),
  displayName: z.string().min(1).max(64),
  clientId: z.string().min(1),
  clientSecret: z.string(),
  scopes: z.array(z.string().min(1)).optional(),
  enabled: z.boolean().default(true),
  discoveryUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  userInfoUrl: z.string().url().optional(),
  pkce: z.boolean().default(true),
  usernameClaim: z.string().min(1).max(128).default("preferred_username"),
})

const hasEndpoints = (p: z.infer<typeof OAuthProviderBaseSchema>) =>
  Boolean(p.discoveryUrl) || (p.authorizationUrl && p.tokenUrl && p.userInfoUrl)

const endpointsMessage =
  "Provide discoveryUrl, or all three of authorizationUrl, tokenUrl, userInfoUrl."

function validateOAuthProvider(
  provider: z.infer<typeof OAuthProviderBaseSchema>,
  ctx: z.RefinementCtx,
  requireSecret: boolean
): void {
  if (requireSecret && provider.clientSecret.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["clientSecret"],
      message: "Client secret is required",
    })
  }

  if (!hasEndpoints(provider)) {
    ctx.addIssue({
      code: "custom",
      path: ["discoveryUrl"],
      message: endpointsMessage,
    })
  }
  if (!provider.usernameClaim || provider.usernameClaim.trim().length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["usernameClaim"],
      message: "Username claim is required for custom providers.",
    })
  }
}

const OAuthProviderSchemaBase = OAuthProviderBaseSchema

export const OAuthProviderSchema = OAuthProviderSchemaBase.superRefine(
  (provider, ctx) => validateOAuthProvider(provider, ctx, true)
)

export const OAuthProviderSubmissionSchema = OAuthProviderSchemaBase.superRefine(
  (provider, ctx) => validateOAuthProvider(provider, ctx, false)
)

export type OAuthProviderSubmission = z.infer<
  typeof OAuthProviderSubmissionSchema
>

const EncoderVariantSchema = z.object({
  height: z
    .number()
    .int()
    .min(ENCODER_HEIGHT_MIN)
    .max(ENCODER_HEIGHT_MAX)
    .multipleOf(2),
  codec: z.enum(ENCODER_CODECS).optional(),
  quality: z.number().int().min(0).max(51).optional(),
  preset: z.string().min(1).max(64).optional(),
  audioBitrateKbps: z.number().int().min(64).max(256).optional(),
})

const EncoderConfigInnerSchema = z.object({
  hwaccel: z.enum(HWACCEL_KINDS).default("software"),
  codec: z.enum(ENCODER_CODECS).default("h264"),
  quality: z.number().int().min(0).max(51).default(23),
  preset: z.string().min(1).max(64).default("medium"),
  audioBitrateKbps: z.number().int().min(64).max(256).default(128),
  qsvDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  vaapiDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  keepSource: z.boolean().default(true),
  variants: z
    .array(EncoderVariantSchema)
    .min(1)
    .max(6)
    .refine(
      (list) => new Set(list.map((v) => v.height)).size === list.length,
      "Variants must have unique heights"
    )
    .default([{ height: 1080 }, { height: 720 }, { height: 480 }]),
})

const EncoderConfigSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const r = raw as Record<string, unknown>
  if (r.variants === undefined && r.targetHeight !== undefined) {
    const legacyTarget = Number(r.targetHeight)
    const ladder = [legacyTarget, 720, 480].filter(
      (h) => Number.isFinite(h) && h > 0
    )
    const seen = new Set<number>()
    const heights: number[] = []
    for (const h of ladder) {
      if (!seen.has(h)) {
        seen.add(h)
        heights.push(h)
      }
    }
    if (heights.length > 0) r.variants = heights.map((h) => ({ height: h }))
  }
  // `targetHeight` is no longer part of the schema; drop it so the next
  // disk write doesn't carry the stale field forever.
  if ("targetHeight" in r) delete r.targetHeight
  return r
}, EncoderConfigInnerSchema)

const LimitsConfigSchema = z.object({
  maxUploadBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024 * 1024) // 64 GiB hard ceiling — anything larger
    // is almost certainly a misconfig and will crush the disk first.
    .default(4 * 1024 * 1024 * 1024),
  uploadTtlSec: z
    .number()
    .int()
    .min(60)
    .max(24 * 60 * 60)
    .default(900),
  queueConcurrency: z.number().int().min(1).max(16).default(1),
})

const IntegrationsConfigSchema = z.object({
  steamgriddbApiKey: z.string().default(""),
})

const RuntimeConfigSchema = z.object({
  openRegistrations: z.boolean().default(false),
  setupComplete: z.boolean().default(false),
  emailPasswordEnabled: z.boolean().default(true),
  passkeyEnabled: z.boolean().default(true),
  requireAuthToBrowse: z.boolean().default(true),
  oauthProvider: OAuthProviderSchema.nullable().default(null),
  encoder: EncoderConfigSchema.default(EncoderConfigInnerSchema.parse({})),
  limits: LimitsConfigSchema.default(LimitsConfigSchema.parse({})),
  integrations: IntegrationsConfigSchema.default(
    IntegrationsConfigSchema.parse({})
  ),
})

export const EncoderConfigPatchSchema = EncoderConfigInnerSchema.partial()
export const LimitsConfigPatchSchema = LimitsConfigSchema.partial()
export const IntegrationsConfigPatchSchema = IntegrationsConfigSchema.partial()

export type { EncoderCodec, EncoderConfig, EncoderVariant, IntegrationsConfig, LimitsConfig, OAuthProviderConfig, RuntimeConfig } from "@workspace/db/contracts"

const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({})

function resolveConfigPath(): string {
  if (env.RUNTIME_CONFIG_PATH && env.RUNTIME_CONFIG_PATH.length > 0) {
    return path.resolve(env.RUNTIME_CONFIG_PATH)
  }
  return path.resolve(process.cwd(), "data/runtime-config.json")
}

const CONFIG_PATH = resolveConfigPath()

function migrateLegacyFields(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const r = { ...(raw as Record<string, unknown>) }
  if (Array.isArray(r.oauthProviders) && r.oauthProvider === undefined) {
    const first = r.oauthProviders.find(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === "object" && !Array.isArray(p)
    )
    if (first) r.oauthProvider = stripLegacyProviderFields(first)
  }
  if (
    r.oauthProvider &&
    typeof r.oauthProvider === "object" &&
    !Array.isArray(r.oauthProvider)
  ) {
    r.oauthProvider = stripLegacyProviderFields(
      r.oauthProvider as Record<string, unknown>
    )
  }
  if ("oauthProviders" in r) delete r.oauthProviders
  if ("oauthDiscord" in r) delete r.oauthDiscord
  if ("oauthTwitch" in r) delete r.oauthTwitch
  return r
}

function stripLegacyProviderFields(
  p: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...p }
  if (next.displayName === undefined && typeof next.buttonText === "string") {
    next.displayName = next.buttonText
  }
  for (const key of ["kind", "buttonColor", "textColor", "icon", "buttonText"]) {
    if (key in next) delete next[key]
  }
  return next
}

function loadFromDisk(): RuntimeConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG }
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8")
    const json = migrateLegacyFields(JSON.parse(raw))
    const result = RuntimeConfigSchema.safeParse(json)
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.warn(
        `[config-store] ${CONFIG_PATH} failed validation, falling back to defaults:`,
        JSON.stringify(result.error.flatten())
      )
      return { ...DEFAULT_CONFIG }
    }
    return result.data
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config-store] failed to read ${CONFIG_PATH}, falling back to defaults:`,
      err instanceof Error ? err.message : err
    )
    return { ...DEFAULT_CONFIG }
  }
}

function writeToDisk(next: RuntimeConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${CONFIG_PATH}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8")
  fs.renameSync(tmpPath, CONFIG_PATH)
}

let state: RuntimeConfig = loadFromDisk()

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>
) => void
const listeners = new Set<Listener>()

function commit(next: RuntimeConfig): void {
  const prev = state
  writeToDisk(next)
  state = next
  for (const listener of listeners) {
    try {
      listener(state, prev)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[config-store] listener threw:", err)
    }
  }
}

export interface ConfigStore {
  get<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K]
  getAll(): Readonly<RuntimeConfig>
  set<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]): void
  patch(patch: Partial<RuntimeConfig>): void
  subscribe(fn: Listener): () => void
  readonly filePath: string
}

export const configStore: ConfigStore = {
  get(key) {
    return state[key]
  },
  getAll() {
    return { ...state }
  },
  set(key, value) {
    commit(RuntimeConfigSchema.parse({ ...state, [key]: value }))
  },
  patch(patch) {
    commit(RuntimeConfigSchema.parse({ ...state, ...patch }))
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get filePath() {
    return CONFIG_PATH
  },
}
