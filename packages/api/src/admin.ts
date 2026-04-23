import type { ApiContext } from "./client"
import { readJsonOrThrow } from "./http"

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

export interface AdminOAuthProvider {
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

export const ENCODER_HWACCELS = [
  "software",
  "nvenc",
  "qsv",
  "amf",
  "vaapi",
] as const
export type EncoderHwaccel = (typeof ENCODER_HWACCELS)[number]

export const ENCODER_CODECS = ["h264", "hevc", "av1"] as const
export type EncoderCodec = (typeof ENCODER_CODECS)[number]

export const ENCODER_HEIGHT_SUGGESTIONS = [
  360, 480, 720, 1080, 1440, 2160,
] as const
export const ENCODER_HEIGHT_MIN = 144
export const ENCODER_HEIGHT_MAX = 4320

export interface AdminEncoderVariant {
  height: number
  codec?: EncoderCodec
  quality?: number
  preset?: string
  audioBitrateKbps?: number
}

export interface AdminEncoderConfig {
  hwaccel: EncoderHwaccel
  codec: EncoderCodec
  quality: number
  preset: string
  audioBitrateKbps: number
  qsvDevice: string
  vaapiDevice: string
  keepSource: boolean
  variants: AdminEncoderVariant[]
}

export interface AdminLimitsConfig {
  maxUploadBytes: number
  uploadTtlSec: number
  queueConcurrency: number
}

export const INTEGRATIONS_REDACTED = "***"

export interface AdminIntegrationsConfig {
  steamgriddbApiKey: string
}

export interface AdminEncoderCapabilities {
  ffmpegOk: boolean
  ffmpegVersion: string | null
  available: Record<
    EncoderHwaccel,
    { h264: boolean; hevc: boolean; av1: boolean }
  >
}

export interface AdminRuntimeConfig {
  authBaseURL: string
  openRegistrations: boolean
  setupComplete: boolean
  emailPasswordEnabled: boolean
  passkeyEnabled: boolean
  requireAuthToBrowse: boolean
  oauthProvider: AdminOAuthProvider | null
  encoder: AdminEncoderConfig
  limits: AdminLimitsConfig
  integrations: AdminIntegrationsConfig
}

export function createAdminApi(context: ApiContext) {
  return {
    async fetchRuntimeConfig(): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin["runtime-config"].$get()
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateRuntimeConfig(input: {
      openRegistrations?: boolean
      emailPasswordEnabled?: boolean
      passkeyEnabled?: boolean
      requireAuthToBrowse?: boolean
    }): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin["runtime-config"].$patch({
        json: input,
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async saveOAuthConfig(input: {
      oauthProvider: AdminOAuthProvider | null
    }): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin["oauth-config"].$put({
        json: {
          oauthProvider: input.oauthProvider ? { ...input.oauthProvider } : null,
        },
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateEncoderConfig(
      patch: Partial<AdminEncoderConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin.encoder.$patch({ json: patch })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateLimitsConfig(
      patch: Partial<AdminLimitsConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin.limits.$patch({ json: patch })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateIntegrationsConfig(
      patch: Partial<AdminIntegrationsConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin.integrations.$patch({
        json: patch,
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async fetchEncoderCapabilities(): Promise<AdminEncoderCapabilities> {
      const res = await context.client.api.admin.encoder.capabilities.$get()
      return readJsonOrThrow<AdminEncoderCapabilities>(res)
    },

    async reEncodeAllClips(): Promise<{ enqueued: number }> {
      const res = await context.client.api.admin.clips["re-encode"].$post()
      return readJsonOrThrow<{ enqueued: number }>(res)
    },
  }
}
