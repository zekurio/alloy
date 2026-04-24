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

const ProviderIdPattern = /^[a-z0-9-]+$/

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/contracts"
export const HWACCEL_KINDS = ENCODER_HWACCELS
export type HwaccelKind = EncoderHwaccel
export type { UsernameClaim } from "@workspace/contracts"

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
  quotaClaim: z.string().min(1).max(128).optional(),
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

export const OAuthProviderSubmissionSchema =
  OAuthProviderSchemaBase.superRefine((provider, ctx) =>
    validateOAuthProvider(provider, ctx, false)
  )

export type OAuthProviderSubmission = z.infer<
  typeof OAuthProviderSubmissionSchema
>

function legacyEncoderName(
  hwaccel: EncoderHwaccel,
  codec: EncoderCodec
): string {
  if (hwaccel === "software") {
    switch (codec) {
      case "h264":
        return "libx264"
      case "hevc":
        return "libx265"
      case "av1":
        return "libsvtav1"
    }
  }
  return `${codec}_${hwaccel}`
}

const EncoderVariantSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
    const variant = { ...(raw as Record<string, unknown>) }
    if (variant.encoder === undefined) {
      const legacyHwaccel = variant.hwaccel
      const legacyCodec = variant.codec
      if (
        ENCODER_HWACCELS.includes(legacyHwaccel as EncoderHwaccel) &&
        ENCODER_CODECS.includes(legacyCodec as EncoderCodec)
      ) {
        variant.encoder = legacyEncoderName(
          legacyHwaccel as EncoderHwaccel,
          legacyCodec as EncoderCodec
        )
        variant.hwaccel = ""
      }
    }
    if (variant.extraInputArgs === undefined) variant.extraInputArgs = ""
    if (variant.extraOutputArgs === undefined) variant.extraOutputArgs = ""
    return variant
  },
  z.object({
    name: z.string().min(1).max(64),
    hwaccel: z.string().max(128).default(""),
    height: z
      .number()
      .int()
      .min(ENCODER_HEIGHT_MIN)
      .max(ENCODER_HEIGHT_MAX)
      .multipleOf(2),
    encoder: z.string().max(128).default(""),
    quality: z.number().int().min(0).max(51),
    preset: z.string().min(1).max(64).optional(),
    audioBitrateKbps: z.number().int().min(64).max(256),
    extraInputArgs: z.string().max(2048).default(""),
    extraOutputArgs: z.string().max(4096).default(""),
  })
)

const EncoderConfigInnerSchema = z.object({
  enabled: z.boolean().default(false),
  qsvDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  vaapiDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  keepSource: z.boolean().default(true),
  variants: z.array(EncoderVariantSchema).default([]),
})

const EncoderConfigSchema = EncoderConfigInnerSchema

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
