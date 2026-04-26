import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

import {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  type EncoderHwaccel,
  type EncoderCodec,
  type RuntimeConfig,
} from "@workspace/contracts"
import { env } from "../env"
import { publishConfigChange } from "./config-events"
import {
  OAuthProviderSchema,
  OAuthProviderSubmissionSchema,
  type OAuthProviderSubmission,
} from "./config-oauth-schema"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/contracts"
export const HWACCEL_KINDS = ENCODER_HWACCELS
export type HwaccelKind = EncoderHwaccel
export type { UsernameClaim } from "@workspace/contracts"

export { OAuthProviderSchema, OAuthProviderSubmissionSchema }
export type { OAuthProviderSubmission }

function inferLegacyEncoderSettings(
  variants: unknown
): { hwaccel: EncoderHwaccel; codec: EncoderCodec } | null {
  if (!Array.isArray(variants)) return null
  for (const rawVariant of variants) {
    if (
      !rawVariant ||
      typeof rawVariant !== "object" ||
      Array.isArray(rawVariant)
    ) {
      continue
    }

    const variant = rawVariant as Record<string, unknown>
    const legacyHwaccel =
      variant.hwaccel === "software" ? "none" : variant.hwaccel
    const legacyCodec = variant.codec
    if (
      ENCODER_HWACCELS.includes(legacyHwaccel as EncoderHwaccel) &&
      ENCODER_CODECS.includes(legacyCodec as EncoderCodec)
    ) {
      return {
        hwaccel: legacyHwaccel as EncoderHwaccel,
        codec: legacyCodec as EncoderCodec,
      }
    }

    const encoder = typeof variant.encoder === "string" ? variant.encoder : ""
    const inferred = inferFromEncoderName(encoder)
    if (inferred) return inferred
  }
  return null
}

function inferLegacyVariantCodec(
  variant: Record<string, unknown>
): EncoderCodec | null {
  if (ENCODER_CODECS.includes(variant.codec as EncoderCodec)) {
    return variant.codec as EncoderCodec
  }
  const encoder = typeof variant.encoder === "string" ? variant.encoder : ""
  return inferFromEncoderName(encoder)?.codec ?? null
}

function inferFromEncoderName(
  encoder: string
): { hwaccel: EncoderHwaccel; codec: EncoderCodec } | null {
  switch (encoder) {
    case "libx264":
      return { hwaccel: "none", codec: "h264" }
    case "libx265":
      return { hwaccel: "none", codec: "hevc" }
    case "libsvtav1":
      return { hwaccel: "none", codec: "av1" }
  }

  const match =
    /^(h264|hevc|av1)_(amf|nvenc|qsv|rkmpp|vaapi|videotoolbox|v4l2m2m)$/.exec(
      encoder
    )
  if (!match) return null
  return {
    codec: match[1] as EncoderCodec,
    hwaccel: match[2] as EncoderHwaccel,
  }
}

const EncoderVariantSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
    const variant = { ...(raw as Record<string, unknown>) }
    const legacyCodec = inferLegacyVariantCodec(variant)
    if (legacyCodec) variant.codec = legacyCodec
    if (variant.extraInputArgs === undefined) variant.extraInputArgs = ""
    if (variant.extraOutputArgs === undefined) variant.extraOutputArgs = ""
    delete variant.hwaccel
    delete variant.encoder
    return variant
  },
  z.object({
    name: z.string().min(1).max(64),
    codec: z.enum(ENCODER_CODECS).default("h264"),
    height: z
      .number()
      .int()
      .min(ENCODER_HEIGHT_MIN)
      .max(ENCODER_HEIGHT_MAX)
      .multipleOf(2),
    quality: z.number().int().min(0).max(51),
    preset: z.string().min(1).max(64).optional(),
    audioBitrateKbps: z.number().int().min(64).max(256),
    extraInputArgs: z.string().max(2048).default(""),
    extraOutputArgs: z.string().max(4096).default(""),
  })
)

const EncoderConfigInnerSchema = z.object({
  enabled: z.boolean().default(false),
  hwaccel: z.enum(ENCODER_HWACCELS).default("none"),
  qsvDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  vaapiDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  keepSource: z.boolean().default(true),
  variants: z.array(EncoderVariantSchema).default([]),
})

const EncoderConfigSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const config = { ...(raw as Record<string, unknown>) }
  const inferred = inferLegacyEncoderSettings(config.variants)
  if (config.hwaccel === undefined && inferred)
    config.hwaccel = inferred.hwaccel
  if (config.hwaccel === "software") config.hwaccel = "none"
  const fallbackCodec = ENCODER_CODECS.includes(config.codec as EncoderCodec)
    ? (config.codec as EncoderCodec)
    : (inferred?.codec ?? "h264")
  if (Array.isArray(config.variants)) {
    config.variants = config.variants.map((rawVariant) => {
      if (
        !rawVariant ||
        typeof rawVariant !== "object" ||
        Array.isArray(rawVariant)
      ) {
        return rawVariant
      }
      const variant = { ...(rawVariant as Record<string, unknown>) }
      if (variant.codec === undefined && variant.encoder === undefined) {
        variant.codec = fallbackCodec
      }
      return variant
    })
  }
  delete config.codec
  return config
}, EncoderConfigInnerSchema)

const LimitsConfigSchema = z.object({
  maxUploadBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024 * 1024) // 64 GiB hard ceiling — anything larger
    // is almost certainly a misconfig and will crush the disk first.
    .default(4 * 1024 * 1024 * 1024),
  defaultStorageQuotaBytes: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .default(null),
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

export type {
  EncoderCodec,
  EncoderConfig,
  EncoderVariant,
  IntegrationsConfig,
  LimitsConfig,
  OAuthProviderConfig,
  RuntimeConfig,
} from "@workspace/contracts"

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
  if ("emailPasswordEnabled" in r) delete r.emailPasswordEnabled
  return r
}

function stripLegacyProviderFields(
  p: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...p }
  if (next.displayName === undefined && typeof next.buttonText === "string") {
    next.displayName = next.buttonText
  }
  for (const key of [
    "kind",
    "buttonColor",
    "textColor",
    "icon",
    "buttonText",
  ]) {
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
  publishConfigChange(state, prev)
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
