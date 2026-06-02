import { z } from "zod"

import {
  DEFAULT_GAME_CLASSIFIER_FILENAME,
  DEFAULT_GAME_CLASSIFIER_MODEL_NAME,
  DEFAULT_GAME_CLASSIFIER_MODEL_VERSION,
  DEFAULT_GAME_CLASSIFIER_REPO_ID,
  DEFAULT_GAME_CLASSIFIER_REVISION,
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  RUNTIME_CONFIG_VERSION,
  type RuntimeConfig,
  STORAGE_DRIVERS,
} from "@workspace/contracts"

import { env } from "../env"
import { randomBase64Url } from "../runtime/crypto"
import { OAuthProvidersSchema } from "./oauth-schema"

const DEFAULT_MACHINE_LEARNING_URL = Deno.env.get("MACHINE_LEARNING_URL") ??
  "http://localhost:2662"

function randomSecret(): string {
  return randomBase64Url(32)
}

const EncoderVariantSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
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

const EncoderConfigInnerSchema = z.object({
  enabled: z.boolean().default(false),
  hwaccel: z.enum(ENCODER_HWACCELS).default("none"),
  qsvDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  vaapiDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  defaultVariantId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .nullable()
    .default(null),
  variants: z.array(EncoderVariantSchema).default([]),
})

const EncoderConfigSchema = EncoderConfigInnerSchema

const LimitsConfigSchema = z.object({
  maxUploadBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024 * 1024)
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

function envFlag(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name)
  if (raw === undefined) return fallback
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "")
}

const GameClassifierModelConfigSchema = z.object({
  modelName: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .default(DEFAULT_GAME_CLASSIFIER_MODEL_NAME),
  modelVersion: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .nullable()
    .default(DEFAULT_GAME_CLASSIFIER_MODEL_VERSION),
  repoId: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .default(DEFAULT_GAME_CLASSIFIER_REPO_ID),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .default(DEFAULT_GAME_CLASSIFIER_FILENAME),
  revision: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .default(DEFAULT_GAME_CLASSIFIER_REVISION),
  checkpointPath: z.string().trim().min(1).max(1024).nullable().default(null),
})

const MachineLearningConfigSchema = z.object({
  enabled: z.boolean().default(envFlag("MACHINE_LEARNING_ENABLED", true)),
  baseUrl: z
    .string()
    .url()
    .default(DEFAULT_MACHINE_LEARNING_URL)
    .transform(normalizeBaseUrl),
  requestTimeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  gameClassifier: GameClassifierModelConfigSchema.default(
    GameClassifierModelConfigSchema.parse({}),
  ),
})

const ServerSecretsConfigSchema = z.object({
  viewerCookieSecret: z.string().min(32).default(randomSecret),
})

const LoginSplashConfigSchema = z.object({
  enabled: z.boolean().default(false),
  clipIds: z.array(z.string().uuid()).max(48).default([]),
  generatedAt: z.string().datetime().nullable().default(null),
})

const AppearanceConfigSchema = z.object({
  loginSplash: LoginSplashConfigSchema.default(
    LoginSplashConfigSchema.parse({}),
  ),
})

function normalizePublicUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/api\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

const FsStorageConfigSchema = z.object({
  root: z
    .string()
    .min(1)
    .default(env.ALLOY_STORAGE_DIR ?? "./data/server/storage"),
  publicBaseUrl: z
    .string()
    .url()
    .default(env.PUBLIC_SERVER_URL)
    .transform(normalizePublicUrl),
  hmacSecret: z.string().min(32),
})

const S3StorageConfigBaseSchema = z.object({
  bucket: z.string().default(""),
  region: z.string().default("auto"),
  endpoint: z.string().url().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  forcePathStyle: z.boolean().default(false),
  presignExpiresSec: z.number().int().positive().default(900),
})

const S3StorageConfigSchema = S3StorageConfigBaseSchema.superRefine(
  (config, ctx) => {
    const hasAccessKey = config.accessKeyId !== undefined &&
      config.accessKeyId.trim().length > 0
    const hasSecret = config.secretAccessKey !== undefined &&
      config.secretAccessKey.trim().length > 0

    if (hasAccessKey === hasSecret) return

    ctx.addIssue({
      code: "custom",
      path: hasAccessKey ? ["secretAccessKey"] : ["accessKeyId"],
      message:
        "S3 access key ID and secret access key must be configured together.",
    })
  },
)

const DEFAULT_FS_STORAGE_CONFIG = FsStorageConfigSchema.parse({
  hmacSecret: randomSecret(),
})

const DEFAULT_S3_STORAGE_CONFIG = S3StorageConfigSchema.parse({})

const StorageConfigSchema = z
  .object({
    driver: z.enum(STORAGE_DRIVERS).default("fs"),
    fs: FsStorageConfigSchema.default(DEFAULT_FS_STORAGE_CONFIG),
    s3: S3StorageConfigSchema.default(DEFAULT_S3_STORAGE_CONFIG),
  })
  .superRefine((config, ctx) => {
    if (config.driver === "s3" && config.s3.bucket.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["s3", "bucket"],
        message: "S3 bucket is required when storage driver is s3.",
      })
    }
  })

export const RuntimeConfigSchema = z.object({
  runtimeConfigVersion: z.literal(RUNTIME_CONFIG_VERSION).default(
    RUNTIME_CONFIG_VERSION,
  ),
  openRegistrations: z.boolean().default(false),
  setupComplete: z.boolean().default(false),
  passkeyEnabled: z.boolean().default(true),
  requireAuthToBrowse: z.boolean().default(true),
  oauthProviders: OAuthProvidersSchema.default([]),
  encoder: EncoderConfigSchema.default(EncoderConfigInnerSchema.parse({})),
  limits: LimitsConfigSchema.default(LimitsConfigSchema.parse({})),
  integrations: IntegrationsConfigSchema.default(
    IntegrationsConfigSchema.parse({}),
  ),
  machineLearning: MachineLearningConfigSchema.default(
    MachineLearningConfigSchema.parse({}),
  ),
  appearance: AppearanceConfigSchema.default(
    AppearanceConfigSchema.parse({}),
  ),
  secrets: ServerSecretsConfigSchema.default(
    ServerSecretsConfigSchema.parse({}),
  ),
  storage: StorageConfigSchema.default({
    driver: "fs",
    fs: DEFAULT_FS_STORAGE_CONFIG,
    s3: DEFAULT_S3_STORAGE_CONFIG,
  }),
})

export const EncoderConfigPatchSchema = EncoderConfigInnerSchema.partial()
export const LimitsConfigPatchSchema = LimitsConfigSchema.partial()
export const IntegrationsConfigPatchSchema = IntegrationsConfigSchema.partial()
export const MachineLearningConfigPatchSchema = MachineLearningConfigSchema
  .partial().extend({
    gameClassifier: GameClassifierModelConfigSchema.partial().optional(),
  })
export const AppearanceConfigPatchSchema = AppearanceConfigSchema.partial()
export const FsStorageConfigPatchSchema = FsStorageConfigSchema.partial()
export const S3StorageConfigPatchSchema = S3StorageConfigBaseSchema.partial()
  .extend({
    endpoint: z.string().url().nullable().optional(),
    accessKeyId: z.string().nullable().optional(),
    secretAccessKey: z.string().nullable().optional(),
  })
export const StorageConfigPatchSchema = z.object({
  driver: z.enum(STORAGE_DRIVERS).optional(),
  fs: FsStorageConfigPatchSchema.optional(),
  s3: S3StorageConfigPatchSchema.optional(),
})

const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({
  storage: {
    driver: "fs",
    fs: DEFAULT_FS_STORAGE_CONFIG,
    s3: DEFAULT_S3_STORAGE_CONFIG,
  },
})

export function bootstrapDefaultConfig(): RuntimeConfig {
  const parsed = RuntimeConfigSchema.safeParse({})
  return parsed.success ? parsed.data : DEFAULT_CONFIG
}
