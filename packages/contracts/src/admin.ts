import {
  AdminOidcConfigSchema,
  NonEmptyStringSchema,
  OidcConfigSchema,
  UrlStringSchema,
} from "./admin-auth"
import { t } from "./schema"
import type { UserRole, UserStatus } from "./shared"
import { ThemeAccentsSchema, type ThemeAccents } from "./theme"
import { DEFAULT_UPLOAD_LIMITS, UploadLimitsSchema } from "./upload-limits"

export {
  AdminOidcConfigSchema,
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_TOKEN_AUTH_METHODS,
  OAUTH_USERNAME_CLAIM_DEFAULT,
  OIDC_CLIENT_SECRET_SOURCES,
  OIDC_DISPLAY_NAME_DEFAULT,
  OIDC_PROVIDER_ID,
  OIDC_SCOPES_DEFAULT,
  OidcConfigSchema,
} from "./admin-auth"
export type {
  AdminAuthConfigPatch,
  AdminOidcConfig,
  AdminOidcConfigPatch,
  OAuthProviderConfig,
  OAuthTokenAuthMethod,
  OidcClientSecretSource,
  OidcConfig,
  UsernameClaim,
} from "./admin-auth"

const PositiveIntegerSchema = t.number().int().positive()

export const UPLOAD_TTL_MIN_SEC = 60
export const UPLOAD_TTL_MAX_SEC = 24 * 60 * 60

export const LimitsConfigSchema = t.object({
  /** Storage quota for new accounts; null means unlimited. */
  defaultStorageQuotaBytes: t
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .$default(null),
  /** How long an upload link stays valid after it is issued. */
  uploadTtlSec: t
    .number()
    .int()
    .min(UPLOAD_TTL_MIN_SEC)
    .max(UPLOAD_TTL_MAX_SEC)
    .$default(900),
})

export type LimitsConfig = t.infer<typeof LimitsConfigSchema>

export const StorageConfigSchema = t.looseObject({
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

export type StorageConfig = t.infer<typeof StorageConfigSchema>

export type AdminStorageConfig = StorageConfig

export const LOGIN_SPLASH_MAX_BLUR_PX = 48
export const LOGIN_SPLASH_MAX_DARKEN_OPACITY = 1

export const LoginSplashConfigSchema = t.looseObject({
  enabled: t.boolean(),
  blurPx: t.number().nonnegative().max(LOGIN_SPLASH_MAX_BLUR_PX),
  darkenOpacity: t.number().nonnegative().max(LOGIN_SPLASH_MAX_DARKEN_OPACITY),
})

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

/**
 * Server-wide appearance: the login backdrop treatment and the accents of the
 * Alloy theme. Structured and validated: admins tune these through
 * typed fields rather than raw CSS overrides.
 */
export const AppearanceConfigSchema = t.looseObject({
  loginSplash: LoginSplashConfigSchema,
  /** Lowercase `#rrggbb` per appearance; null keeps Alloy's own lavender. */
  accentColors: ThemeAccentsSchema.$default({ light: null, dark: null }),
})

export type AppearanceConfig = t.infer<typeof AppearanceConfigSchema>

export const TRANSCODE_VIDEO_CODECS = ["h264", "hevc", "av1"] as const
export const VideoCodecSchema = t.enum(TRANSCODE_VIDEO_CODECS)
export type VideoCodec = t.infer<typeof VideoCodecSchema>

export const HARDWARE_ACCELERATIONS = [
  "none",
  "nvenc",
  "qsv",
  "vaapi",
  "videotoolbox",
] as const
export const HardwareAccelerationSchema = t.enum(HARDWARE_ACCELERATIONS)
export type HardwareAcceleration = t.infer<typeof HardwareAccelerationSchema>

export const DEFAULT_VAAPI_DEVICE = "/dev/dri/renderD128"

export const RenditionTierConfigSchema = t.object({
  height: t.number().int().min(144).max(4320).multipleOf(2),
  maxFps: t.number().int().min(1).max(240),
  maxrateKbps: t.number().int().min(100).max(100000),
  /** Per-tier codec override; falls back to the global `videoCodec`. */
  codec: VideoCodecSchema.optional(),
  /** Marks the tier whose rendition powers OpenGraph/social embeds; at most one. */
  og: t.boolean().optional(),
})
export type RenditionTierConfig = t.infer<typeof RenditionTierConfigSchema>

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

/**
 * Orders renditions best first: taller, then higher frame rate. Ties (tiers
 * that differ only in codec) compare equal, so a stable sort keeps their
 * order. The admin ladder, the encoder, and the player menu all list
 * renditions in this order.
 */
export function compareRenditions(
  a: { height: number; fps: number },
  b: { height: number; fps: number },
): number {
  return b.height - a.height || b.fps - a.fps
}

export const DEFAULT_RENDITION_TIERS: RenditionTierConfig[] = [
  { height: 1080, maxFps: 60, maxrateKbps: 8000, og: true },
  { height: 720, maxFps: 60, maxrateKbps: 5000 },
  { height: 480, maxFps: 30, maxrateKbps: 2500 },
]

/**
 * How the media pipeline encodes new clips. Every tier at or below the
 * source's height encodes; taller tiers are skipped. The og-flagged tier
 * (default: the tallest) powers OpenGraph/social embeds.
 * `videoCodec` is the default codec for every tier; a tier may override it
 * with its own `codec`. `quality` is a CRF-scale value (lower = better) mapped
 * to the equivalent rate-control knob of hardware encoders. Audio is always
 * stereo AAC for embed compatibility; only its bitrate is configurable.
 */
export const TranscodingConfigSchema = t.looseObject({
  videoCodec: VideoCodecSchema.$default("h264"),
  hardwareAcceleration: HardwareAccelerationSchema.$default("none"),
  // `catch` keeps config load resilient: a blank/invalid stored device falls
  // back to the default render node instead of failing startup.
  vaapiDevice: t
    .string()
    .trim()
    .min(1)
    .$default(DEFAULT_VAAPI_DEVICE)
    .catch(DEFAULT_VAAPI_DEVICE),
  quality: t.number().int().min(10).max(51).$default(22),
  audioBitrateKbps: t.number().int().min(64).max(320).$default(128),
  tiers: t
    .array(RenditionTierConfigSchema)
    .min(1)
    .max(6)
    .$default(DEFAULT_RENDITION_TIERS)
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

export type TranscodingConfig = t.infer<typeof TranscodingConfigSchema>

/**
 * Result of probing the configured ffmpeg binary for encoder support. `status`
 * is "missing" when the encoder is not compiled into the binary, "failed" when
 * it is listed but a functional test encode errored (e.g. no GPU present), and
 * "ok" when a test encode succeeded.
 */
export const TranscodingEncoderProbeSchema = t.looseObject({
  codec: VideoCodecSchema,
  acceleration: HardwareAccelerationSchema,
  encoder: t.string(),
  status: t.enum(["ok", "failed", "missing"]),
  error: t.string().optional(),
})
export type TranscodingEncoderProbe = t.infer<
  typeof TranscodingEncoderProbeSchema
>

export const TranscodingCapabilitiesSchema = t.looseObject({
  ffmpegPath: t.string(),
  version: t.string().nullable(),
  jellyfin: t.boolean(),
  probedAt: t.string(),
  encoders: t.array(TranscodingEncoderProbeSchema),
})
export type TranscodingCapabilities = t.infer<
  typeof TranscodingCapabilitiesSchema
>

export interface AdminUserStorageRow {
  id: string
  username: string
  image: string | null
  role: UserRole
  status: UserStatus
  disabledAt: string | null
  adminSuspendedAt?: string | null
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
 * Secret-free server configuration as exposed through admin responses.
 * Storage is deploy-time env; setup state lives in Postgres. Every other
 * section starts from built-in defaults, takes ALLOY_* environment variables
 * on top, and then any value an admin saved in the settings UI.
 */
export const RuntimeConfigSchema = t.looseObject({
  runtimeConfigVersion: PositiveIntegerSchema.refine(
    (value) => value === RUNTIME_CONFIG_VERSION,
    `runtimeConfigVersion must be ${RUNTIME_CONFIG_VERSION}`,
  ),
  openRegistrations: t.boolean(),
  setupComplete: t.boolean(),
  passkeyEnabled: t.boolean(),
  requireAuthToBrowse: t.boolean(),
  oidc: OidcConfigSchema,
  limits: LimitsConfigSchema,
  uploadLimits: UploadLimitsSchema.$default(DEFAULT_UPLOAD_LIMITS),
  storage: StorageConfigSchema,
  appearance: AppearanceConfigSchema,
  transcoding: TranscodingConfigSchema,
})

export type RuntimeConfig = t.infer<typeof RuntimeConfigSchema>

/**
 * What each editable setting resolves to without the settings UI: the
 * environment's value, else the built-in default. A setting whose value
 * differs from its default was saved in the UI; saving the default value
 * again hands the setting back to the environment.
 */
export const AdminConfigDefaultsSchema = t.looseObject({
  openRegistrations: t.boolean(),
  passkeyEnabled: t.boolean(),
  requireAuthToBrowse: t.boolean(),
  oidc: AdminOidcConfigSchema,
  limits: LimitsConfigSchema,
  uploadLimits: UploadLimitsSchema,
  appearance: AppearanceConfigSchema,
  transcoding: TranscodingConfigSchema,
})

export type AdminConfigDefaults = t.infer<typeof AdminConfigDefaultsSchema>

/**
 * Admin runtime config response. Built from {@link RuntimeConfig} plus
 * secret-source flags; it carries no secret values.
 */
export const AdminRuntimeConfigSchema = RuntimeConfigSchema.extend({
  oidc: AdminOidcConfigSchema,
  defaults: AdminConfigDefaultsSchema,
  authBaseURL: UrlStringSchema,
})

export type AdminRuntimeConfig = t.infer<typeof AdminRuntimeConfigSchema>

export interface PublicAuthProvider {
  providerId: string
  displayName: string
  /** Whether signing in with this provider can create a new account. */
  allowSignUp: boolean
}

export const DESKTOP_AUTH_CAPABILITY_VERSION = 1

export interface PublicDesktopAuthConfig {
  version: number
}

/** Response of `GET /api/setup/status`, for the browser that asks. */
export interface SetupStatus {
  adminAccountRequired: boolean
  setupRequired: boolean
  /**
   * This browser must present the setup token before it can create the
   * admin: it is outside the local network and has not presented it yet.
   */
  tokenRequired: boolean
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
  /** Accents for the Alloy theme; null keeps Alloy's own. */
  accentColors: ThemeAccents
}
