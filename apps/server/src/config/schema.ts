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
} from "@workspace/contracts"

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
  machineLearning: MachineLearningConfigSchema.default(
    MachineLearningConfigSchema.parse({}),
  ),
  appearance: AppearanceConfigSchema.default(
    AppearanceConfigSchema.parse({}),
  ),
})

export const EncoderConfigPatchSchema = EncoderConfigInnerSchema.partial()
export const LimitsConfigPatchSchema = LimitsConfigSchema.partial()
/** Write-only patch for the (secret) SteamGridDB key. */
export const IntegrationsSecretPatchSchema = z.object({
  steamgriddbApiKey: z.string().optional(),
})
export const MachineLearningConfigPatchSchema = MachineLearningConfigSchema
  .partial().extend({
    gameClassifier: GameClassifierModelConfigSchema.partial().optional(),
  })
export const AppearanceConfigPatchSchema = AppearanceConfigSchema.partial()

const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({})

export function bootstrapDefaultConfig(): RuntimeConfig {
  const parsed = RuntimeConfigSchema.safeParse({})
  return parsed.success ? parsed.data : DEFAULT_CONFIG
}
