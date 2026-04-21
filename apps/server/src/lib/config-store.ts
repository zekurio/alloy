import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

import { env } from "../env"

const ProviderIdPattern = /^[a-z0-9-]+$/

export const USERNAME_CLAIM_SUGGESTIONS = [
  "preferred_username",
  "username",
  "nickname",
  "name",
  "display_name",
  "given_name",
  "email",
] as const
export type UsernameClaim = string

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

export const OAuthProviderSchema = OAuthProviderBaseSchema.extend({
  clientSecret: z.string().min(1),
}).refine(hasEndpoints, { message: endpointsMessage })

export const OAuthProviderSubmissionSchema = OAuthProviderBaseSchema.refine(
  hasEndpoints,
  { message: endpointsMessage }
)

export type OAuthProviderConfig = z.infer<typeof OAuthProviderSchema>
export type OAuthProviderSubmission = z.infer<
  typeof OAuthProviderSubmissionSchema
>

export const HWACCEL_KINDS = [
  "software",
  "nvenc",
  "qsv",
  "amf",
  "vaapi",
] as const
export type HwaccelKind = (typeof HWACCEL_KINDS)[number]

export const ENCODER_CODECS = ["h264", "hevc", "av1"] as const
export type EncoderCodec = (typeof ENCODER_CODECS)[number]

export const ENCODER_HEIGHT_SUGGESTIONS = [
  360, 480, 720, 1080, 1440, 2160,
] as const

export const ENCODER_HEIGHT_MIN = 144
export const ENCODER_HEIGHT_MAX = 4320

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

export type EncoderVariant = z.infer<typeof EncoderVariantSchema>

const EncoderConfigInnerSchema = z.object({
  hwaccel: z.enum(HWACCEL_KINDS).default("software"),
  codec: z.enum(ENCODER_CODECS).default("h264"),
  quality: z.number().int().min(0).max(51).default(23),
  preset: z.string().min(1).max(64).default("medium"),
  audioBitrateKbps: z.number().int().min(64).max(256).default(128),
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

export type EncoderConfig = z.infer<typeof EncoderConfigSchema>

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

export type LimitsConfig = z.infer<typeof LimitsConfigSchema>

const IntegrationsConfigSchema = z.object({
  steamgriddbApiKey: z.string().default(""),
})

export type IntegrationsConfig = z.infer<typeof IntegrationsConfigSchema>

const RuntimeConfigSchema = z.object({
  openRegistrations: z.boolean().default(false),
  setupComplete: z.boolean().default(false),
  emailPasswordEnabled: z.boolean().default(true),
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

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>

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
  const r = raw as Record<string, unknown>
  const provider = r.oauthProvider
  if (provider && typeof provider === "object" && !Array.isArray(provider)) {
    const p = provider as Record<string, unknown>
    if (p.displayName === undefined && typeof p.buttonText === "string") {
      p.displayName = p.buttonText
    }
    if ("buttonText" in p) delete p.buttonText
  }
  return r
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
