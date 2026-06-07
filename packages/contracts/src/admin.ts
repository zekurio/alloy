export type UsernameClaim = string
export type DisplayNameClaim = string

export const OAUTH_USERNAME_CLAIM_DEFAULT = "preferred_username"
export const OAUTH_DISPLAY_NAME_CLAIM_DEFAULT = "name"

export const OAUTH_QUOTA_CLAIM_DEFAULT = "alloy_quota"
export const OAUTH_ROLE_CLAIM_DEFAULT = "alloy_role"

/**
 * Stored OAuth provider metadata. Note the absence of `clientSecret`: provider
 * secrets live in the server-only secret store, never in this struct, so no
 * config read path can serialize them by accident.
 */
export interface OAuthProviderConfig {
  providerId: string
  displayName: string
  clientId: string
  scopes?: string[]
  enabled: boolean
  buttonColor?: string
  buttonTextColor?: string
  iconUrl?: string
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  pkce?: boolean
  usernameClaim?: UsernameClaim
  displayNameClaim?: DisplayNameClaim
  quotaClaim?: string
  roleClaim?: string
}

/**
 * Admin-facing OAuth provider. `clientSecretSet` reports whether a secret is
 * configured (read), and `clientSecret` carries a new value when the admin is
 * setting one (write-only — it is never populated on responses).
 */
export type AdminOAuthProvider = OAuthProviderConfig & {
  clientSecretSet: boolean
  clientSecret?: string
}

export const ENCODER_HWACCELS = [
  "none",
  "amf",
  "nvenc",
  "qsv",
  "rkmpp",
  "vaapi",
  "videotoolbox",
  "v4l2m2m",
] as const

export type EncoderHwaccel = (typeof ENCODER_HWACCELS)[number]

export const ENCODER_CODECS = ["h264", "hevc", "av1"] as const

export type EncoderCodec = (typeof ENCODER_CODECS)[number]

export const ENCODER_HEIGHT_MIN = 144
export const ENCODER_HEIGHT_MAX = 4320

export const ENCODER_TONEMAPPING_ALGORITHMS = [
  "none",
  "linear",
  "gamma",
  "clip",
  "reinhard",
  "hable",
  "mobius",
  "bt2390",
] as const

export type EncoderTonemappingAlgorithm =
  (typeof ENCODER_TONEMAPPING_ALGORITHMS)[number]

export const ENCODER_TONEMAPPING_MODES = [
  "auto",
  "max",
  "rgb",
  "lum",
  "itp",
] as const

export type EncoderTonemappingMode = (typeof ENCODER_TONEMAPPING_MODES)[number]

export const ENCODER_TONEMAPPING_RANGES = ["auto", "limited", "full"] as const

export type EncoderTonemappingRange =
  (typeof ENCODER_TONEMAPPING_RANGES)[number]

export interface EncoderTonemappingConfig {
  enabled: boolean
  algorithm: EncoderTonemappingAlgorithm
  mode: EncoderTonemappingMode
  range: EncoderTonemappingRange
  desat: number
  peak: number
  param: number | null
  threshold: number
  vpp: {
    enabled: boolean
    brightness: number
    contrast: number
  }
}

export interface AdminEncoderConfig {
  enabled: boolean
  hwaccel: EncoderHwaccel
  qsvDevice: string
  vaapiDevice: string
  intelLowPowerH264: boolean
  intelLowPowerHevc: boolean
  tonemapping: EncoderTonemappingConfig
}

export type EncoderConfig = AdminEncoderConfig

export interface AdminLimitsConfig {
  maxUploadBytes: number
  defaultStorageQuotaBytes: number | null
  uploadTtlSec: number
}

export type LimitsConfig = AdminLimitsConfig

/**
 * Integrations as exposed to admins: secret values are reported only as
 * presence flags, never echoed back.
 */
export interface AdminIntegrationsConfig {
  steamgriddbApiKeySet: boolean
}

export interface AdminMachineLearningConfig {
  enabled: boolean
  baseUrl: string
  requestTimeoutMs: number
  gameClassifier: AdminGameClassifierModelConfig
}

export type MachineLearningConfig = AdminMachineLearningConfig

export interface AdminGameClassifierModelConfig {
  modelName: string
  modelVersion: string | null
  repoId: string
  filename: string
  revision: string
  checkpointPath: string | null
}

/**
 * Server-only secret material. Persisted apart from {@link RuntimeConfig} and
 * never serialized to any HTTP response — there is no response type that
 * contains these fields.
 */
export interface ServerSecretsConfig {
  viewerCookieSecret: string
  uploadHmacSecret: string
  steamgriddbApiKey: string
  /** OAuth client secrets keyed by `providerId`. */
  oauthClientSecrets: Record<string, string>
}

export interface LoginSplashConfig {
  enabled: boolean
  blurPx: number
  darkenOpacity: number
}

export const LOGIN_SPLASH_IMAGE_PATH = "/api/auth-config/splashscreen.webp"

export function loginSplashImagePath(): string {
  return LOGIN_SPLASH_IMAGE_PATH
}

export interface PublicLoginSplashConfig {
  enabled: boolean
  blurPx: number
  darkenOpacity: number
  imageUrl: string | null
}

export interface AppearanceConfig {
  loginSplash: LoginSplashConfig
}

export interface AdminEncoderCapabilities {
  ffmpegOk: boolean
  ffmpegVersion: string | null
  available: Record<
    EncoderHwaccel,
    { h264: boolean; hevc: boolean; av1: boolean }
  >
}

export interface AdminUserStorageRow {
  id: string
  name: string
  username: string
  email: string
  image: string | null
  role: string | null
  createdAt: string
  storageQuotaBytes: number | null
  storageUsedBytes: number
}

export interface AdminUsersResponse {
  users: AdminUserStorageRow[]
}

export interface AdminUpdateUserInput {
  role?: "user" | "admin"
  storageQuotaBytes?: number | null
}

export const RUNTIME_CONFIG_VERSION = 1

/**
 * Persisted, non-secret runtime configuration (the `config.json` contents).
 * Secret material lives in {@link ServerSecretsConfig}, stored separately, so
 * this object — and anything derived from it, including `export` — is safe to
 * serialize by construction.
 */
export interface RuntimeConfig {
  runtimeConfigVersion: number
  openRegistrations: boolean
  setupComplete: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  oauthProviders: OAuthProviderConfig[]
  encoder: EncoderConfig
  limits: LimitsConfig
  machineLearning: MachineLearningConfig
  appearance: AppearanceConfig
}

/**
 * Admin runtime config response. Built from {@link RuntimeConfig} plus
 * secret-presence flags — it carries no secret values.
 */
export interface AdminRuntimeConfig extends Omit<
  RuntimeConfig,
  "oauthProviders"
> {
  oauthProviders: AdminOAuthProvider[]
  integrations: AdminIntegrationsConfig
  authBaseURL: string
}

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
