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
}

export type AdminOAuthProvider = OAuthProviderConfig

export const ENCODER_HWACCELS = [
  "software",
  "nvenc",
  "qsv",
  "amf",
  "vaapi",
] as const

export type EncoderHwaccel = (typeof ENCODER_HWACCELS)[number]
export type HwaccelKind = EncoderHwaccel

export const ENCODER_CODECS = ["h264", "hevc", "av1"] as const

export type EncoderCodec = (typeof ENCODER_CODECS)[number]

export const ENCODER_HEIGHT_MIN = 144
export const ENCODER_HEIGHT_MAX = 4320

export interface AdminEncoderVariant {
  name: string
  hwaccel: string
  height: number
  encoder: string
  quality: number
  preset?: string
  audioBitrateKbps: number
  extraInputArgs: string
  extraOutputArgs: string
}

export type EncoderVariant = AdminEncoderVariant

export interface AdminEncoderConfig {
  enabled: boolean
  qsvDevice: string
  vaapiDevice: string
  keepSource: boolean
  variants: AdminEncoderVariant[]
}

export type EncoderConfig = AdminEncoderConfig

export interface AdminLimitsConfig {
  maxUploadBytes: number
  uploadTtlSec: number
  queueConcurrency: number
}

export type LimitsConfig = AdminLimitsConfig

export const INTEGRATIONS_REDACTED = "***"

export interface AdminIntegrationsConfig {
  steamgriddbApiKey: string
}

export type IntegrationsConfig = AdminIntegrationsConfig

export interface AdminEncoderCapabilities {
  ffmpegOk: boolean
  ffmpegVersion: string | null
  available: Record<
    EncoderHwaccel,
    { h264: boolean; hevc: boolean; av1: boolean }
  >
}

export interface RuntimeConfig {
  openRegistrations: boolean
  setupComplete: boolean
  emailPasswordEnabled: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  oauthProvider: OAuthProviderConfig | null
  encoder: EncoderConfig
  limits: LimitsConfig
  integrations: IntegrationsConfig
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
  emailPasswordEnabled: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  provider: PublicAuthProvider | null
}

export interface PasskeySignUpRequest {
  email: string
  username: string
}

export interface PasskeySignUpResponse {
  context: string
}
