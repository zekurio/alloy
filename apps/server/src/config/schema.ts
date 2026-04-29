import { randomBytes } from "node:crypto"
import { z } from "zod"

import {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  STORAGE_DRIVERS,
  type EncoderOpenGraphTarget,
  type RuntimeConfig,
} from "@workspace/contracts"

import { env } from "../env"
import { OAuthProviderSchema } from "./oauth-schema"

const EncoderVariantSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
    const variant = { ...(raw as Record<string, unknown>) }
    if (variant.extraInputArgs === undefined) variant.extraInputArgs = ""
    if (variant.extraOutputArgs === undefined) variant.extraOutputArgs = ""
    return variant
  },
  z.object({
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
)

const EncoderOpenGraphTargetSchema: z.ZodType<EncoderOpenGraphTarget> =
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("source") }),
    z.object({ type: z.literal("defaultVariant") }),
    z.object({
      type: z.literal("variant"),
      variantId: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[a-z0-9][a-z0-9-]*$/),
    }),
  ])

const EncoderConfigInnerSchema = z.object({
  enabled: z.boolean().default(false),
  remuxEnabled: z.boolean().default(false),
  hwaccel: z.enum(ENCODER_HWACCELS).default("none"),
  qsvDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  vaapiDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  keepSource: z.boolean().default(true),
  defaultVariantId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .nullable()
    .default(null),
  openGraphTarget: EncoderOpenGraphTargetSchema.default({ type: "source" }),
  variants: z.array(EncoderVariantSchema).default([]),
})

const EncoderConfigSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const config = { ...(raw as Record<string, unknown>) }
  if (Array.isArray(config.variants)) {
    const usedIds = new Set<string>()
    config.variants = config.variants.map((rawVariant) => {
      if (
        !rawVariant ||
        typeof rawVariant !== "object" ||
        Array.isArray(rawVariant)
      ) {
        return rawVariant
      }
      const variant = { ...(rawVariant as Record<string, unknown>) }
      if (typeof variant.id !== "string" || variant.id.trim() === "") {
        variant.id = buildVariantId(variant.name, usedIds)
      } else {
        variant.id = normalizeVariantId(variant.id, usedIds)
      }
      return variant
    })
  }
  if (config.defaultVariantId === undefined) {
    const firstVariant = Array.isArray(config.variants)
      ? (config.variants[0] as Record<string, unknown> | undefined)
      : undefined
    config.defaultVariantId =
      typeof firstVariant?.id === "string" ? firstVariant.id : null
  }
  if (config.openGraphTarget === undefined) {
    config.openGraphTarget = { type: "source" }
  }
  return config
}, EncoderConfigInnerSchema)

function buildVariantId(name: unknown, usedIds: Set<string>): string {
  const base =
    typeof name === "string"
      ? name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : ""
  return normalizeVariantId(base || "variant", usedIds)
}

function normalizeVariantId(raw: string, usedIds: Set<string>): string {
  const base =
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "variant"
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    const suffixText = `-${suffix}`
    id = `${base.slice(0, 80 - suffixText.length)}${suffixText}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}

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

const ServerSecretsConfigSchema = z.object({
  viewerCookieSecret: z
    .string()
    .min(32)
    .default(() => randomBytes(32).toString("base64url")),
})

function normalizePublicUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/api\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

const FsStorageConfigSchema = z.object({
  root: z.string().min(1).default("./data/storage"),
  publicBaseUrl: z
    .string()
    .url()
    .default(env.PUBLIC_SERVER_URL)
    .transform(normalizePublicUrl),
  hmacSecret: z.string().min(32),
})

const S3StorageConfigSchema = z.object({
  bucket: z.string().default(""),
  region: z.string().default("auto"),
  endpoint: z.string().url().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  forcePathStyle: z.boolean().default(false),
  presignExpiresSec: z.number().int().positive().default(900),
})

const DEFAULT_FS_STORAGE_CONFIG = FsStorageConfigSchema.parse({
  hmacSecret: randomBytes(32).toString("base64url"),
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
  secrets: ServerSecretsConfigSchema.default(
    ServerSecretsConfigSchema.parse({})
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
export const FsStorageConfigPatchSchema = FsStorageConfigSchema.partial()
export const S3StorageConfigPatchSchema =
  S3StorageConfigSchema.partial().extend({
    endpoint: z.string().url().nullable().optional(),
    accessKeyId: z.string().nullable().optional(),
    secretAccessKey: z.string().nullable().optional(),
  })
export const StorageConfigPatchSchema = z.object({
  driver: z.enum(STORAGE_DRIVERS).optional(),
  fs: FsStorageConfigPatchSchema.optional(),
  s3: S3StorageConfigPatchSchema.optional(),
})

export const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({
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
