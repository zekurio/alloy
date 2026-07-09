import { z } from "zod"

import type { JobKind } from "./jobs"
import type { UserStatus } from "./shared"

export type UsernameClaim = string

export const OAUTH_USERNAME_CLAIM_DEFAULT = "preferred_username"
export const OAUTH_AVATAR_CLAIM_DEFAULT = "picture"

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
  avatarClaim: NonEmptyStringSchema.optional(),
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

/**
 * Which auth config sections are env-managed. A locked key is sourced from its
 * ALLOY_* environment variable and rejects admin writes until the variable is
 * unset (Immich-style declarative override).
 */
export const AuthConfigLocksSchema = z.looseObject({
  openRegistrations: z.boolean(),
  passkeyEnabled: z.boolean(),
  requireAuthToBrowse: z.boolean(),
  oauthProviders: z.boolean(),
})

export type AuthConfigLocks = z.infer<typeof AuthConfigLocksSchema>

export interface AdminAuthConfigPatch {
  openRegistrations?: boolean
  passkeyEnabled?: boolean
  requireAuthToBrowse?: boolean
}

/**
 * Admin submission shape for the OAuth provider list. `clientSecret` is
 * write-only; absent or empty keeps the provider's stored secret. Fields with
 * server-side defaults (claims, pkce, uidClaim, ...) may be omitted.
 */
export type AdminOAuthProviderInput = Partial<OAuthProviderConfig> & {
  providerId: string
  displayName: string
  clientId: string
  enabled: boolean
  clientSecret?: string
}

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

/**
 * Sweep kinds an admin can trigger manually from the jobs dashboard. Only these
 * four have "run now" affordances; every other kind runs on its own schedule
 * or in response to uploads/playback.
 */
export const ADMIN_SWEEP_KINDS = [
  "clip.renditions-sweep",
  "clip.thumbnail-sweep",
  "clip.verify-assets",
  "storage.orphan-gc",
] as const satisfies readonly JobKind[]
export type AdminSweepKind = (typeof ADMIN_SWEEP_KINDS)[number]

const NonNegativeIntSchema = z.number().int().nonnegative()

export const AdminJobKindRowSchema = z.object({
  kind: z.string(),
  queue: z.string(),
  pending: NonNegativeIntSchema,
  running: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  completed: NonNegativeIntSchema,
  paused: z.boolean(),
  schedule: z
    .object({
      everyMs: z.number().int().positive(),
      nextRunAt: z.string().nullable(),
    })
    .optional(),
})
export type AdminJobKindRow = z.infer<typeof AdminJobKindRowSchema>

export const AdminRenditionSweepSummarySchema = z.object({
  finishedAt: z.string(),
  mode: z.enum(["stale", "force"]),
  scanned: NonNegativeIntSchema,
  upToDate: NonNegativeIntSchema,
  adopted: NonNegativeIntSchema,
  enqueued: NonNegativeIntSchema,
  unprobed: NonNegativeIntSchema,
  quarantined: NonNegativeIntSchema,
})
export type AdminRenditionSweepSummary = z.infer<
  typeof AdminRenditionSweepSummarySchema
>

export const AdminStorageVerifySummarySchema = z.object({
  finishedAt: z.string(),
  checked: NonNegativeIntSchema,
  missingRenditions: NonNegativeIntSchema,
  missingCuts: NonNegativeIntSchema,
  missingThumbs: NonNegativeIntSchema,
  missingSources: NonNegativeIntSchema,
  repaired: NonNegativeIntSchema,
})
export type AdminStorageVerifySummary = z.infer<
  typeof AdminStorageVerifySummarySchema
>

export const AdminStorageGcSummarySchema = z.object({
  finishedAt: z.string(),
  scanned: NonNegativeIntSchema,
  deletedOrphanObjects: NonNegativeIntSchema,
  deletedStaleAssets: NonNegativeIntSchema,
})
export type AdminStorageGcSummary = z.infer<typeof AdminStorageGcSummarySchema>

export const AdminJobsSweepsSchema = z.object({
  renditionSweep: AdminRenditionSweepSummarySchema.nullable(),
  storageVerify: AdminStorageVerifySummarySchema.nullable(),
  storageGc: AdminStorageGcSummarySchema.nullable(),
})
export type AdminJobsSweeps = z.infer<typeof AdminJobsSweepsSchema>

export const AdminJobsSummarySchema = z.object({
  kinds: z.array(AdminJobKindRowSchema),
  sweeps: AdminJobsSweepsSchema,
})
export type AdminJobsSummary = z.infer<typeof AdminJobsSummarySchema>

export const AdminFailedJobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  clipId: z.string().nullable(),
  error: z.string().nullable(),
  attempt: NonNegativeIntSchema,
  finishedAt: z.string().nullable(),
})
export type AdminFailedJob = z.infer<typeof AdminFailedJobSchema>

export const AdminFailedJobsPageSchema = z.object({
  items: z.array(AdminFailedJobSchema),
  nextCursor: z.string().nullable(),
})
export type AdminFailedJobsPage = z.infer<typeof AdminFailedJobsPageSchema>

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
