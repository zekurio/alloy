import { z } from "zod"

import { isObjectRecord } from "./object"
import type { UserStatus } from "./shared"

export type UsernameClaim = string

export const OAUTH_USERNAME_CLAIM_DEFAULT = "preferred_username"

export const OAUTH_QUOTA_CLAIM_DEFAULT = "alloy_quota"
export const OAUTH_ROLE_CLAIM_DEFAULT = "alloy_role"

function oauthClientSecretAuthMethod<Suffix extends "post" | "basic">(
  suffix: Suffix,
): `client_secret_${Suffix}` {
  return `client_${"secret"}_${suffix}`
}

export const OAUTH_CLIENT_SECRET_POST_AUTH_METHOD =
  oauthClientSecretAuthMethod("post")
export const OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD =
  oauthClientSecretAuthMethod("basic")
export const OAUTH_TOKEN_AUTH_METHODS = [
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
] as const
export type OAuthTokenAuthMethod = (typeof OAUTH_TOKEN_AUTH_METHODS)[number]

/**
 * Stored OAuth provider metadata. Note the absence of `clientSecret`: provider
 * secrets live in the server-only secret store, never in this struct, so no
 * config read path can serialize them by accident.
 */
const NonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must be a non-empty string")

const PositiveIntegerSchema = z.number().int().positive()
const NullablePositiveIntegerSchema = PositiveIntegerSchema.nullable()
const UrlStringSchema = z.string().url()
const OptionalUrlStringSchema = UrlStringSchema.optional()

const OAuthProviderConfigFields = {
  providerId: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  clientId: NonEmptyStringSchema,
  scopes: z.array(z.string()).optional(),
  enabled: z.boolean(),
  buttonColor: z.string().optional(),
  buttonTextColor: z.string().optional(),
  iconUrl: OptionalUrlStringSchema,
  discoveryUrl: OptionalUrlStringSchema,
  authorizationUrl: OptionalUrlStringSchema,
  tokenUrl: OptionalUrlStringSchema,
  userInfoUrl: OptionalUrlStringSchema,
  pkce: z.boolean().optional(),
  tokenAuthMethod: z.enum(OAUTH_TOKEN_AUTH_METHODS).optional(),
  uidClaim: NonEmptyStringSchema.optional(),
  fetchUserInfo: z.boolean().optional(),
  authParams: z.record(z.string(), z.string()).optional(),
  usernameClaim: NonEmptyStringSchema.optional(),
  quotaClaim: NonEmptyStringSchema.optional(),
  roleClaim: NonEmptyStringSchema.optional(),
}

function requireOAuthClaimFields(
  provider: {
    quotaClaim?: string
    roleClaim?: string
  },
  ctx: z.RefinementCtx,
) {
  for (const key of ["quotaClaim", "roleClaim"] as const) {
    if (provider[key] !== undefined) continue
    ctx.addIssue({
      code: "custom",
      path: [key],
      message: `${key} is required`,
    })
  }
}

export const OAuthProviderConfigSchema = z
  .looseObject(OAuthProviderConfigFields)
  .superRefine(requireOAuthClaimFields)

export type OAuthProviderConfig = z.infer<typeof OAuthProviderConfigSchema>

/**
 * Admin-facing OAuth provider. `clientSecretSet` reports whether a secret is
 * configured (read), and `clientSecret` carries a new value when the admin is
 * setting one (write-only — it is never populated on responses).
 */
export const AdminOAuthProviderSchema = z
  .looseObject({
    ...OAuthProviderConfigFields,
    clientSecretSet: z.boolean(),
    clientSecret: z.string().optional(),
  })
  .superRefine(requireOAuthClaimFields)

export type AdminOAuthProvider = z.infer<typeof AdminOAuthProviderSchema>

export const AdminLimitsConfigSchema = z.looseObject({
  defaultStorageQuotaBytes: NullablePositiveIntegerSchema,
  uploadTtlSec: PositiveIntegerSchema,
})

export type AdminLimitsConfig = z.infer<typeof AdminLimitsConfigSchema>

export type LimitsConfig = AdminLimitsConfig

/**
 * Integrations as exposed to admins: secret values are reported only as
 * presence flags, never echoed back.
 */
export const AdminIntegrationsConfigSchema = z.looseObject({
  steamgriddbApiKeySet: z.boolean(),
  steamgriddbConfigured: z.boolean(),
})

export type AdminIntegrationsConfig = z.infer<
  typeof AdminIntegrationsConfigSchema
>

export const STORAGE_DRIVER_TYPES = ["fs"] as const
export type StorageDriverType = (typeof STORAGE_DRIVER_TYPES)[number]

export const FilesystemStorageConfigSchema = z.looseObject({
  /**
   * Filesystem root for clip sources and derived clip media. Relative paths
   * resolve from the server working directory; absolute paths are used as-is.
   */
  clipsPath: NonEmptyStringSchema,
  /**
   * Filesystem root for clip thumbnails. Relative paths resolve from the
   * server working directory; absolute paths are used as-is.
   */
  thumbnailsPath: NonEmptyStringSchema,
  /**
   * Filesystem root for user-owned assets such as avatars, banners, and
   * profile backgrounds. Relative paths resolve from the server working
   * directory; absolute paths are used as-is.
   */
  usersPath: NonEmptyStringSchema,
  /**
   * Filesystem root for admin-authored game assets (hero, grid, logo, icon).
   * Relative paths resolve from the server working directory; absolute paths
   * are used as-is.
   */
  gamesPath: NonEmptyStringSchema,
})

export type FilesystemStorageConfig = z.infer<
  typeof FilesystemStorageConfigSchema
>

const StorageConfigFields = {
  driver: z.enum(STORAGE_DRIVER_TYPES).default("fs"),
  fs: FilesystemStorageConfigSchema,
}

function migrateLegacyStorageConfig(value: unknown): unknown {
  if (!isObjectRecord(value)) {
    return value
  }
  if (value.fs !== undefined) {
    return {
      driver: value.driver,
      fs: value.fs,
    }
  }

  return {
    driver: value.driver,
    fs: {
      clipsPath: legacyStoragePath(value, "clips"),
      thumbnailsPath: legacyStoragePath(value, "thumbnails"),
      usersPath: legacyStoragePath(value, "users"),
      gamesPath: legacyStoragePath(value, "games"),
    },
  }
}

function legacyStoragePath(
  record: Record<string, unknown>,
  namespace: "clips" | "thumbnails" | "users" | "games",
): string {
  const override = record[`${namespace}Path`]
  if (typeof override === "string" && override.trim().length > 0) {
    return override
  }
  const root =
    typeof record.path === "string" && record.path.trim().length > 0
      ? record.path
      : "storage"
  return `${root.trim().replace(/[\\/]+$/, "")}/${namespace}`
}

const StorageConfigObjectSchema = z.looseObject(StorageConfigFields)

export const StorageConfigSchema = z.preprocess(
  migrateLegacyStorageConfig,
  StorageConfigObjectSchema,
)

export type StorageConfig = z.infer<typeof StorageConfigSchema>

export const AdminStorageConfigSchema = StorageConfigSchema

export type AdminStorageConfig = StorageConfig

export const LoginSplashConfigSchema = z.looseObject({
  enabled: z.boolean(),
  blurPx: z.number().nonnegative().max(48),
  darkenOpacity: z.number().nonnegative().max(1),
})

export type LoginSplashConfig = z.infer<typeof LoginSplashConfigSchema>

export interface PublicLoginSplashConfig {
  enabled: boolean
  blurPx: number
  darkenOpacity: number
}

/**
 * Response of `GET /api/auth-config/backdrops`: a freshly-randomized set of
 * public clips the login page rotates through as full-screen backdrops. `clipIds`
 * is kept for older clients; `clips` carries the thumbnail cache version.
 */
export interface LoginBackdropClip {
  id: string
  thumbVersion: string
}

export interface LoginBackdropsResponse {
  clipIds: string[]
  clips: LoginBackdropClip[]
}

export const AppearanceConfigSchema = z.looseObject({
  loginSplash: LoginSplashConfigSchema,
})

export type AppearanceConfig = z.infer<typeof AppearanceConfigSchema>

export const TRANSCODE_VIDEO_CODECS = ["h264", "hevc", "av1"] as const
export const VideoCodecSchema = z.enum(TRANSCODE_VIDEO_CODECS)
export type VideoCodec = z.infer<typeof VideoCodecSchema>

export const HARDWARE_ACCELERATIONS = [
  "none",
  "nvenc",
  "qsv",
  "vaapi",
  "videotoolbox",
] as const
export const HardwareAccelerationSchema = z.enum(HARDWARE_ACCELERATIONS)
export type HardwareAcceleration = z.infer<typeof HardwareAccelerationSchema>

export const DEFAULT_VAAPI_DEVICE = "/dev/dri/renderD128"

export const RenditionTierConfigSchema = z.object({
  height: z.number().int().min(144).max(4320).multipleOf(2),
  maxFps: z.number().int().min(1).max(240),
  maxrateKbps: z.number().int().min(100).max(100000),
})
export type RenditionTierConfig = z.infer<typeof RenditionTierConfigSchema>

export const DEFAULT_RENDITION_TIERS: RenditionTierConfig[] = [
  { height: 1080, maxFps: 60, maxrateKbps: 8000 },
  { height: 720, maxFps: 60, maxrateKbps: 5000 },
  { height: 480, maxFps: 30, maxrateKbps: 2500 },
]

/**
 * How the media pipeline encodes new clips. Tiers above the source resolution
 * are always skipped; the highest tier (clamped to the source) doubles as the
 * OpenGraph/compat rendition, so at least one tier must exist. `quality` is a
 * CRF-scale value (lower = better) mapped to the equivalent rate-control knob
 * of hardware encoders. Audio is always stereo AAC for embed compatibility;
 * only its bitrate is configurable. Legacy `enable1080p/720p/480p` toggles are
 * migrated to an explicit tier list on parse.
 */
export const TranscodingConfigSchema = z.preprocess(
  migrateLegacyTranscodingConfig,
  z.looseObject({
    videoCodec: VideoCodecSchema.default("h264"),
    hardwareAcceleration: HardwareAccelerationSchema.default("none"),
    // `catch` keeps config load resilient: a blank/invalid stored device falls
    // back to the default render node instead of failing startup.
    vaapiDevice: z
      .string()
      .trim()
      .min(1)
      .default(DEFAULT_VAAPI_DEVICE)
      .catch(DEFAULT_VAAPI_DEVICE),
    quality: z.number().int().min(10).max(51).default(22),
    audioBitrateKbps: z.number().int().min(64).max(320).default(128),
    tiers: z
      .array(RenditionTierConfigSchema)
      .min(1)
      .max(6)
      .default(DEFAULT_RENDITION_TIERS)
      .refine(
        (tiers) =>
          new Set(tiers.map((tier) => tier.height)).size === tiers.length,
        "tier heights must be unique",
      ),
  }),
)

export type TranscodingConfig = z.infer<typeof TranscodingConfigSchema>

function migrateLegacyTranscodingConfig(value: unknown) {
  if (!isObjectRecord(value)) return value
  if ("tiers" in value) return value
  const hasLegacyToggles =
    "enable1080p" in value || "enable720p" in value || "enable480p" in value
  if (!hasLegacyToggles) return value
  const toggles: Record<number, unknown> = {
    1080: value.enable1080p,
    720: value.enable720p,
    480: value.enable480p,
  }
  const tiers = DEFAULT_RENDITION_TIERS.filter(
    (tier) => toggles[tier.height] !== false,
  )
  return { tiers: tiers.length > 0 ? tiers : DEFAULT_RENDITION_TIERS }
}

/**
 * Result of probing the configured ffmpeg binary for encoder support. `status`
 * is "missing" when the encoder is not compiled into the binary, "failed" when
 * it is listed but a functional test encode errored (e.g. no GPU present), and
 * "ok" when a test encode succeeded.
 */
export const TranscodingEncoderProbeSchema = z.looseObject({
  codec: VideoCodecSchema,
  acceleration: HardwareAccelerationSchema,
  encoder: z.string(),
  status: z.enum(["ok", "failed", "missing"]),
  error: z.string().optional(),
})
export type TranscodingEncoderProbe = z.infer<
  typeof TranscodingEncoderProbeSchema
>

export const TranscodingCapabilitiesSchema = z.looseObject({
  ffmpegPath: z.string(),
  version: z.string().nullable(),
  jellyfin: z.boolean(),
  probedAt: z.string(),
  encoders: z.array(TranscodingEncoderProbeSchema),
})
export type TranscodingCapabilities = z.infer<
  typeof TranscodingCapabilitiesSchema
>

export interface AdminUserStorageRow {
  id: string
  username: string
  email: string
  image: string | null
  role: string | null
  status: UserStatus
  disabledAt: string | null
  createdAt: string
  storageQuotaBytes: number | null
  storageUsedBytes: number
  clipCount: number
}

export interface AdminUsersResponse {
  users: AdminUserStorageRow[]
}

export interface AdminUpdateUserInput {
  role?: "user" | "admin"
  status?: UserStatus
  storageQuotaBytes?: number | null
}

export const RUNTIME_CONFIG_VERSION = 1

/**
 * Secret-free server configuration as exposed through admin responses. Most
 * fields are deploy-time env/Nix config; DB-backed instance settings currently
 * cover setup completion and login appearance.
 */
export const RuntimeConfigSchema = z.looseObject({
  runtimeConfigVersion: PositiveIntegerSchema.refine(
    (value) => value === RUNTIME_CONFIG_VERSION,
    `runtimeConfigVersion must be ${RUNTIME_CONFIG_VERSION}`,
  ),
  openRegistrations: z.boolean(),
  setupComplete: z.boolean(),
  passkeyEnabled: z.boolean(),
  requireAuthToBrowse: z.boolean(),
  oauthProviders: z.array(OAuthProviderConfigSchema),
  limits: AdminLimitsConfigSchema,
  storage: StorageConfigSchema,
  appearance: AppearanceConfigSchema,
  transcoding: TranscodingConfigSchema,
})

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>

/**
 * Admin runtime config response. Built from {@link RuntimeConfig} plus
 * secret-presence flags — it carries no secret values.
 */
export const AdminRuntimeConfigSchema = z.looseObject({
  runtimeConfigVersion: PositiveIntegerSchema.refine(
    (value) => value === RUNTIME_CONFIG_VERSION,
    `runtimeConfigVersion must be ${RUNTIME_CONFIG_VERSION}`,
  ),
  openRegistrations: z.boolean(),
  setupComplete: z.boolean(),
  passkeyEnabled: z.boolean(),
  requireAuthToBrowse: z.boolean(),
  oauthProviders: z.array(AdminOAuthProviderSchema),
  limits: AdminLimitsConfigSchema,
  storage: AdminStorageConfigSchema,
  appearance: AppearanceConfigSchema,
  transcoding: TranscodingConfigSchema,
  integrations: AdminIntegrationsConfigSchema,
  authBaseURL: UrlStringSchema,
})

export type AdminRuntimeConfig = z.infer<typeof AdminRuntimeConfigSchema>

export interface PublicAuthProvider {
  providerId: string
  displayName: string
  buttonColor?: string
  buttonTextColor?: string
  iconUrl?: string
}

export const DESKTOP_AUTH_CAPABILITY_VERSION = 1

export interface PublicDesktopAuthConfig {
  version: number
}

export interface PublicAuthConfig {
  adminAccountRequired: boolean
  setupRequired: boolean
  openRegistrations: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  desktopAuth: PublicDesktopAuthConfig
  providers: PublicAuthProvider[]
  loginSplash: PublicLoginSplashConfig
}
