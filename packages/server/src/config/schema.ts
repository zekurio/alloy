import {
  ENCODER_HWACCELS,
  ENCODER_TONEMAPPING_ALGORITHMS,
  ENCODER_TONEMAPPING_MODES,
  ENCODER_TONEMAPPING_RANGES,
  RUNTIME_CONFIG_VERSION,
  type RuntimeConfig,
} from "alloy-contracts"
import { z } from "zod"

import { randomBase64Url } from "../runtime/crypto"
import { isValidCronExpression } from "../scheduled-tasks/cron"
import { OAuthProvidersSchema } from "./oauth-schema"

function randomSecret(): string {
  return randomBase64Url(32)
}

const EncoderVppTonemappingConfigBaseSchema = z.object({
  enabled: z.boolean().default(true),
  brightness: z.number().min(-100).max(100).default(16),
  contrast: z.number().min(0).max(10).default(1),
})

const EncoderTonemappingConfigBaseSchema = z.object({
  enabled: z.boolean().default(true),
  algorithm: z.enum(ENCODER_TONEMAPPING_ALGORITHMS).default("bt2390"),
  mode: z.enum(ENCODER_TONEMAPPING_MODES).default("auto"),
  range: z.enum(ENCODER_TONEMAPPING_RANGES).default("auto"),
  desat: z.number().min(0).max(10).default(0),
  peak: z.number().min(0).max(10_000).default(100),
  param: z.number().min(0).max(10).nullable().default(null),
  threshold: z.number().min(0).max(1).default(0.2),
  vpp: EncoderVppTonemappingConfigBaseSchema.default(
    EncoderVppTonemappingConfigBaseSchema.parse({}),
  ),
})

const EncoderTonemappingConfigSchema =
  EncoderTonemappingConfigBaseSchema.default(
    EncoderTonemappingConfigBaseSchema.parse({}),
  )

const EncoderConfigInnerSchema = z.object({
  enabled: z.boolean().default(true),
  hwaccel: z.enum(ENCODER_HWACCELS).default("none"),
  qsvDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  vaapiDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
  intelLowPowerH264: z.boolean().default(false),
  intelLowPowerHevc: z.boolean().default(false),
  tonemapping: EncoderTonemappingConfigSchema,
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
})

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

const ScheduledTaskTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("startup"),
    delayMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    jitterMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .optional(),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .refine(isValidCronExpression, "Invalid cron expression"),
    jitterMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .optional(),
  }),
])

const ScheduledTasksConfigSchema = z
  .record(
    z.string().trim().min(1).max(128),
    z.array(ScheduledTaskTriggerSchema).max(16),
  )
  .default({})

export const RuntimeConfigSchema = z.object({
  runtimeConfigVersion: z
    .literal(RUNTIME_CONFIG_VERSION)
    .default(RUNTIME_CONFIG_VERSION),
  openRegistrations: z.boolean().default(false),
  setupComplete: z.boolean().default(false),
  passkeyEnabled: z.boolean().default(true),
  requireAuthToBrowse: z.boolean().default(true),
  oauthProviders: OAuthProvidersSchema.default([]),
  scheduledTasks: ScheduledTasksConfigSchema,
  encoder: EncoderConfigSchema.default(EncoderConfigInnerSchema.parse({})),
  limits: LimitsConfigSchema.default(LimitsConfigSchema.parse({})),
  appearance: AppearanceConfigSchema.default(AppearanceConfigSchema.parse({})),
})

export const EncoderConfigPatchSchema =
  EncoderConfigInnerSchema.partial().extend({
    tonemapping: EncoderTonemappingConfigBaseSchema.partial()
      .extend({
        vpp: EncoderVppTonemappingConfigBaseSchema.partial().optional(),
      })
      .optional(),
  })
export const LimitsConfigPatchSchema = LimitsConfigSchema.partial()
/** Write-only patch for the (secret) SteamGridDB key. */
export const IntegrationsSecretPatchSchema = z.object({
  steamgriddbApiKey: z.string().optional(),
})
export const AppearanceConfigPatchSchema = AppearanceConfigSchema.partial()
export const ScheduledTaskTriggersSchema = z
  .array(ScheduledTaskTriggerSchema)
  .max(16)

const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({})

export function bootstrapDefaultConfig(): RuntimeConfig {
  const parsed = RuntimeConfigSchema.safeParse({})
  return parsed.success ? parsed.data : DEFAULT_CONFIG
}
