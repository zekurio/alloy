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

export interface OAuthProviderConfig {
  providerId: string
  displayName: string
  clientId: string
  clientSecret: string
  scopes?: string[]
  enabled: boolean
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  pkce?: boolean
  usernameClaim?: UsernameClaim
  quotaClaim?: string
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
export type HwaccelKind = EncoderHwaccel

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

export type EncoderOpenGraphTarget =
  | { type: "none" }
  | { type: "source" }
  | { type: "defaultVariant" }
  | { type: "variant"; variantId: string }

export interface AdminEncoderConfig {
  enabled: boolean
  remuxEnabled: boolean
  hwaccel: EncoderHwaccel
  qsvDevice: string
  vaapiDevice: string
  keepSource: boolean
  defaultVariantId: string | null
  openGraphTarget: EncoderOpenGraphTarget
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

export type AdminS3StorageConfigPatch = Partial<
  Omit<AdminS3StorageConfig, "endpoint" | "accessKeyId" | "secretAccessKey">
> & {
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

export interface AdminUpdateUserStorageQuotaInput {
  storageQuotaBytes: number | null
}

export interface RuntimeConfig {
  openRegistrations: boolean
  setupComplete: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  oauthProvider: OAuthProviderConfig | null
  encoder: EncoderConfig
  limits: LimitsConfig
  integrations: IntegrationsConfig
  storage: StorageConfig
}

export interface AdminRuntimeConfig extends RuntimeConfig {
  authBaseURL: string
}

export interface PublicAuthProvider {
  providerId: string
  displayName: string
}

export interface PublicAuthConfig {
  setupRequired: boolean
  openRegistrations: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  provider: PublicAuthProvider | null
}
