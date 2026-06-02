export const USERNAME_CLAIM_SUGGESTIONS = [
  "preferred_username",
  "username",
  "nickname",
  "name",
  "display_name",
  "given_name",
  "email",
] as const

export type UsernameClaim = string

export const OAUTH_QUOTA_CLAIM_DEFAULT = "alloy_quota"
export const OAUTH_ROLE_CLAIM_DEFAULT = "alloy_role"

export interface OAuthProviderConfig {
  providerId: string
  displayName: string
  clientId: string
  clientSecret: string
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
  quotaClaim?: string
  roleClaim?: string
}

export type AdminOAuthProvider = OAuthProviderConfig

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

export interface AdminEncoderVariant {
  id: string
  name: string
  codec: EncoderCodec
  height: number
  quality: number
  preset?: string
  audioBitrateKbps: number
  extraInputArgs: string
  extraOutputArgs: string
}

export type EncoderVariant = AdminEncoderVariant

export interface AdminEncoderConfig {
  enabled: boolean
  hwaccel: EncoderHwaccel
  qsvDevice: string
  vaapiDevice: string
  defaultVariantId: string | null
  variants: AdminEncoderVariant[]
}

export type EncoderConfig = AdminEncoderConfig

export interface AdminLimitsConfig {
  maxUploadBytes: number
  defaultStorageQuotaBytes: number | null
  uploadTtlSec: number
  queueConcurrency: number
}

export type LimitsConfig = AdminLimitsConfig

export const INTEGRATIONS_REDACTED = "***"

export interface AdminIntegrationsConfig {
  steamgriddbApiKey: string
}

export type IntegrationsConfig = AdminIntegrationsConfig

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

export interface ServerSecretsConfig {
  viewerCookieSecret: string
}

export interface LoginSplashClip {
  id: string
  title: string
  game: string | null
}

export interface LoginSplashConfig {
  enabled: boolean
  clipIds: string[]
  generatedAt: string | null
}

export const LOGIN_SPLASH_LAYOUT_VERSION = 2
export const LOGIN_SPLASH_IMAGE_PATH =
  `/api/auth-config/login-splash-v${LOGIN_SPLASH_LAYOUT_VERSION}.jpg`

export function loginSplashImagePath(generatedAt: string | null): string {
  const parsed = generatedAt ? Date.parse(generatedAt) : Date.now()
  const version = Number.isFinite(parsed) ? parsed : Date.now()
  return `${LOGIN_SPLASH_IMAGE_PATH}?v=${version}`
}

export interface PublicLoginSplashConfig {
  enabled: boolean
  generatedAt: string | null
  imageUrl: string | null
  clips: LoginSplashClip[]
}

export interface AppearanceConfig {
  loginSplash: LoginSplashConfig
}

export const STORAGE_DRIVERS = ["fs", "s3"] as const
export type StorageDriverKind = (typeof STORAGE_DRIVERS)[number]

export interface AdminFsStorageConfig {
  root: string
  publicBaseUrl: string
  hmacSecret: string
}

export interface AdminS3StorageConfig {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle: boolean
  presignExpiresSec: number
}

export type AdminStorageConfig =
  | {
    driver: "fs"
    fs: AdminFsStorageConfig
    s3: AdminS3StorageConfig
  }
  | {
    driver: "s3"
    fs: AdminFsStorageConfig
    s3: AdminS3StorageConfig
  }

export type StorageConfig = AdminStorageConfig

export type AdminFsStorageConfigPatch = Partial<AdminFsStorageConfig>

export type AdminS3StorageConfigPatch =
  & Partial<
    Omit<AdminS3StorageConfig, "endpoint" | "accessKeyId" | "secretAccessKey">
  >
  & {
    endpoint?: string | null
    accessKeyId?: string | null
    secretAccessKey?: string | null
  }

export interface AdminStorageConfigPatch {
  driver?: StorageDriverKind
  fs?: AdminFsStorageConfigPatch
  s3?: AdminS3StorageConfigPatch
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

export interface RuntimeConfig {
  runtimeConfigVersion: number
  openRegistrations: boolean
  setupComplete: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  oauthProviders: OAuthProviderConfig[]
  encoder: EncoderConfig
  limits: LimitsConfig
  integrations: IntegrationsConfig
  machineLearning: MachineLearningConfig
  appearance: AppearanceConfig
  storage: StorageConfig
  secrets: ServerSecretsConfig
}

export interface AdminRuntimeConfig extends RuntimeConfig {
  authBaseURL: string
}

export interface PublicAuthProvider {
  providerId: string
  displayName: string
  buttonColor?: string
  buttonTextColor?: string
  iconUrl?: string
}

export interface PublicAuthConfig {
  adminAccountRequired: boolean
  setupRequired: boolean
  openRegistrations: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  providers: PublicAuthProvider[]
  loginSplash: PublicLoginSplashConfig
}
