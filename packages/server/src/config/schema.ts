import { RUNTIME_CONFIG_VERSION, type RuntimeConfig } from "@alloy/contracts"
import { randomBase64Url } from "@alloy/server/runtime/crypto"
import { z } from "zod"

import { OAuthProvidersSchema } from "./oauth-schema"

function randomSecret(): string {
  return randomBase64Url(32)
}

const LimitsConfigSchema = z.object({
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
})

const S3StorageConfigSchema = z.object({
  bucket: z.string().trim().max(255).default(""),
  region: z.string().trim().min(1).max(128).default("us-east-1"),
  endpoint: z
    .preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z.string().trim().url().nullable(),
    )
    .default(null),
  forcePathStyle: z.boolean().default(false),
})

const StoragePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !hasParentTraversal(value), {
    message: "Storage paths must not contain '..' segments",
  })

const FsStorageConfigSchema = z.object({
  clipsPath: StoragePathSchema.default("storage/clips"),
  usersPath: StoragePathSchema.default("storage/users"),
})

const StorageConfigObjectSchema = z.object({
  driver: z.enum(["fs", "s3"]).default("fs"),
  fs: FsStorageConfigSchema.default(FsStorageConfigSchema.parse({})),
  s3: S3StorageConfigSchema.default(S3StorageConfigSchema.parse({})),
})

const StorageConfigSchema = z.preprocess(
  migrateLegacyStorageConfig,
  StorageConfigObjectSchema,
)

/**
 * Server-only secret material, persisted to `secrets.json` separately from the
 * runtime config. Nothing here is ever included in an HTTP response.
 */
export const ServerSecretsSchema = z.object({
  viewerCookieSecret: z.string().min(32).default(randomSecret),
  // Signs short-lived FS upload tickets. Persisted so in-flight tickets survive
  // restarts. (Previously lived under storage.fs.hmacSecret.)
  uploadHmacSecret: z.string().min(32).default(randomSecret),
  steamgriddbApiKey: z.string().default(""),
  storageS3AccessKeyId: z.string().default(""),
  storageS3SecretAccessKey: z.string().default(""),
  oauthClientSecrets: z.record(z.string(), z.string()).default({}),
})

export type ServerSecrets = z.infer<typeof ServerSecretsSchema>

const LoginSplashConfigSchema = z.object({
  enabled: z.boolean().default(false),
  blurPx: z.number().min(0).max(48).default(24),
  darkenOpacity: z.number().min(0).max(1).default(0.8),
})

const AppearanceConfigSchema = z.object({
  loginSplash: LoginSplashConfigSchema.default(
    LoginSplashConfigSchema.parse({}),
  ),
})

export const RuntimeConfigSchema = z.object({
  runtimeConfigVersion: z
    .literal(RUNTIME_CONFIG_VERSION)
    .default(RUNTIME_CONFIG_VERSION),
  openRegistrations: z.boolean().default(false),
  setupComplete: z.boolean().default(false),
  passkeyEnabled: z.boolean().default(true),
  requireAuthToBrowse: z.boolean().default(true),
  oauthProviders: OAuthProvidersSchema.default([]),
  limits: LimitsConfigSchema.default(LimitsConfigSchema.parse({})),
  storage: StorageConfigSchema.default(StorageConfigSchema.parse({})),
  appearance: AppearanceConfigSchema.default(AppearanceConfigSchema.parse({})),
})

export const LimitsConfigPatchSchema = LimitsConfigSchema.partial()
export const StorageConfigPatchSchema = z.object({
  driver: z.enum(["fs", "s3"]).optional(),
  fs: z
    .object({
      clipsPath: StoragePathSchema.optional(),
      usersPath: StoragePathSchema.optional(),
    })
    .optional(),
  s3: z
    .object({
      bucket: z.string().trim().max(255).optional(),
      region: z.string().trim().min(1).max(128).optional(),
      endpoint: z
        .preprocess(
          (value) =>
            typeof value === "string" && value.trim() === "" ? null : value,
          z.string().trim().url().nullable(),
        )
        .optional(),
      forcePathStyle: z.boolean().optional(),
    })
    .optional(),
  s3AccessKeyId: z.string().optional(),
  s3SecretAccessKey: z.string().optional(),
})
/** Write-only patch for the (secret) SteamGridDB key. */
export const IntegrationsSecretPatchSchema = z.object({
  steamgriddbApiKey: z.string().optional(),
})
export const AppearanceConfigPatchSchema = AppearanceConfigSchema.partial()

const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({})

export function bootstrapDefaultConfig(): RuntimeConfig {
  const parsed = RuntimeConfigSchema.safeParse({})
  return parsed.success ? parsed.data : DEFAULT_CONFIG
}

function hasParentTraversal(value: string): boolean {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..")
}

function migrateLegacyStorageConfig(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value
  }
  const record = value as Record<string, unknown>
  if (record.fs !== undefined) return value

  return {
    driver: record.driver,
    fs: {
      clipsPath: legacyStoragePath(record, "clips"),
      usersPath: legacyStoragePath(record, "users"),
    },
    s3: record.s3,
  }
}

function legacyStoragePath(
  record: Record<string, unknown>,
  namespace: "clips" | "users",
): string {
  const override = record[namespace === "clips" ? "clipsPath" : "usersPath"]
  if (typeof override === "string" && override.trim().length > 0) {
    return override
  }
  const root =
    typeof record.path === "string" && record.path.trim().length > 0
      ? record.path
      : "storage"
  return `${root.trim().replace(/[\\/]+$/, "")}/${namespace}`
}
