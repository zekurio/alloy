import { z } from "zod"

import {
  AdminOAuthProviderSchema,
  AuthConfigLocksSchema,
  OAuthProviderConfigSchema,
} from "./admin-auth"
import type { UserStatus } from "./shared"

export {
  AdminOAuthProviderSchema,
  AuthConfigLocksSchema,
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_TOKEN_AUTH_METHODS,
  OAUTH_USERNAME_CLAIM_DEFAULT,
  OAuthProviderConfigSchema,
} from "./admin-auth"
export type {
  AdminAuthConfigPatch,
  AdminOAuthProvider,
  AdminOAuthProviderInput,
  AuthConfigLocks,
  OAuthProviderConfig,
  OAuthTokenAuthMethod,
  UsernameClaim,
} from "./admin-auth"

const NonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must be a non-empty string")

const PositiveIntegerSchema = z.number().int().positive()
const NullablePositiveIntegerSchema = PositiveIntegerSchema.nullable()
const UrlStringSchema = z.string().url()

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

export const StorageConfigSchema = z.looseObject({
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
   * Filesystem root for miscellaneous assets: user avatars/banners/profile
   * backgrounds and admin-authored game assets (hero, grid, logo, icon).
   * Relative paths resolve from the server working directory; absolute
   * paths are used as-is.
   */
  assetsPath: NonEmptyStringSchema,
})

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
 * public clips the login page rotates through as full-screen backdrops;
 * `thumbVersion` carries the thumbnail cache version.
 */
export interface LoginBackdropClip {
  id: string
  thumbVersion: string
}

export interface LoginBackdropsResponse {
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
  /** Per-tier codec override; falls back to the global `videoCodec`. */
  codec: VideoCodecSchema.optional(),
  /** Marks the tier whose rendition powers OpenGraph/social embeds; at most one. */
  og: z.boolean().optional(),
})
export type RenditionTierConfig = z.infer<typeof RenditionTierConfigSchema>

/**
 * Auto-derived rendition names for a set of tiers/steps, in input order.
 * Base name is `${height}p`; fps is appended only when tiers of the same
 * height differ in fps, and the codec suffix only when names still collide
 * (same height and fps) — minimal disambiguation, so names stay stable
 * URL-safe slugs like "1080p", "1080p60", or "1080p-hevc".
 */
export function deriveRenditionNames(
  entries: readonly { height: number; fps: number; codec: string }[],
): string[] {
  const fpsByHeight = new Map<number, Set<number>>()
  for (const entry of entries) {
    const fpsSet = fpsByHeight.get(entry.height) ?? new Set<number>()
    fpsSet.add(entry.fps)
    fpsByHeight.set(entry.height, fpsSet)
  }
  const baseName = (entry: { height: number; fps: number }) =>
    (fpsByHeight.get(entry.height)?.size ?? 0) > 1
      ? `${entry.height}p${entry.fps}`
      : `${entry.height}p`
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const name = baseName(entry)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return entries.map((entry) => {
    const name = baseName(entry)
    return (counts.get(name) ?? 0) > 1 ? `${name}-${entry.codec}` : name
  })
}

export const DEFAULT_RENDITION_TIERS: RenditionTierConfig[] = [
  { height: 1080, maxFps: 60, maxrateKbps: 8000, og: true },
  { height: 720, maxFps: 60, maxrateKbps: 5000 },
  { height: 480, maxFps: 30, maxrateKbps: 2500 },
]

/**
 * How the media pipeline encodes new clips. Tiers at/above a browser-safe
 * H.264 MP4 source's height are skipped because the source serves them; the
 * og-flagged tier matters for sources that are not browser-safe H.264 MP4.
 * `videoCodec` is the default codec for every tier; a tier may override it
 * with its own `codec`. `quality` is a CRF-scale value (lower = better) mapped
 * to the equivalent rate-control knob of hardware encoders. Audio is always
 * stereo AAC for embed compatibility; only its bitrate is configurable.
 */
export const TranscodingConfigSchema = z.looseObject({
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
        new Set(
          tiers.map(
            (tier) =>
              `${tier.height}:${tier.maxFps}:${tier.codec ?? "default"}`,
          ),
        ).size === tiers.length,
      "tiers must differ in height, max FPS, or codec",
    )
    .refine(
      (tiers) => tiers.filter((tier) => tier.og).length <= 1,
      "only one tier can be the link preview tier",
    ),
})

export type TranscodingConfig = z.infer<typeof TranscodingConfigSchema>

export const JobsConfigSchema = z.looseObject({
  pausedKinds: z.array(z.string()).default([]),
})

export type JobsConfig = z.infer<typeof JobsConfigSchema>

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
  nextCursor: string | null
  total: number
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
  jobs: JobsConfigSchema,
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
  jobs: JobsConfigSchema,
  integrations: AdminIntegrationsConfigSchema,
  authLocks: AuthConfigLocksSchema,
  authBaseURL: UrlStringSchema,
})

export type AdminRuntimeConfig = z.infer<typeof AdminRuntimeConfigSchema>

export {
  ADMIN_SWEEP_KINDS,
  AdminFailedJobSchema,
  AdminFailedJobsPageSchema,
  AdminJobKindRowSchema,
  AdminJobsSummarySchema,
  AdminJobsSweepsSchema,
  AdminRenditionSweepSummarySchema,
  AdminStorageGcSummarySchema,
  AdminStorageVerifySummarySchema,
} from "./admin-jobs"
export type {
  AdminFailedJob,
  AdminFailedJobsPage,
  AdminJobKindRow,
  AdminJobsSummary,
  AdminJobsSweeps,
  AdminRenditionSweepSummary,
  AdminStorageGcSummary,
  AdminStorageVerifySummary,
  AdminSweepKind,
} from "./admin-jobs"

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
