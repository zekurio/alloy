import { api } from "./api"

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
  /** Always empty on read; admins re-enter on every save. */
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
  /** 0–51, mapped to CRF/CQ/global_quality/qp depending on backend. */
  quality: number
  /** Encoder-specific preset name. Suggestions per backend in the UI. */
  preset: string
  audioBitrateKbps: number
  /** QSV child device: DRM render node on Linux or adapter index on Windows. */
  qsvDevice: string
  /** VA-API render node path. Only used when `hwaccel === "vaapi"`. */
  vaapiDevice: string
  keepSource: boolean
  variants: AdminEncoderVariant[]
}

export interface AdminLimitsConfig {
  /** Hard per-file upload cap, bytes. */
  maxUploadBytes: number
  /** Upload ticket TTL, seconds. */
  uploadTtlSec: number
  /**
   * pg-boss localConcurrency. Changes require a server restart — the
   * worker registers concurrency once at boot.
   */
  queueConcurrency: number
}

export const INTEGRATIONS_REDACTED = "***"

export interface AdminIntegrationsConfig {
  /** Empty = unset, `INTEGRATIONS_REDACTED` = set (value hidden). */
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
  requireAuthToBrowse: boolean
  oauthProvider: AdminOAuthProvider | null
  encoder: AdminEncoderConfig
  limits: AdminLimitsConfig
  integrations: AdminIntegrationsConfig
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export async function fetchRuntimeConfig(): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["runtime-config"].$get()
  return readJson<AdminRuntimeConfig>(res)
}

export async function updateRuntimeConfig(input: {
  openRegistrations?: boolean
  emailPasswordEnabled?: boolean
  requireAuthToBrowse?: boolean
}): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["runtime-config"].$patch({ json: input })
  return readJson<AdminRuntimeConfig>(res)
}

export async function saveOAuthConfig(input: {
  oauthProvider: AdminOAuthProvider | null
}): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["oauth-config"].$put({
    json: {
      oauthProvider: input.oauthProvider ? { ...input.oauthProvider } : null,
    },
  })
  return readJson<AdminRuntimeConfig>(res)
}

export async function updateEncoderConfig(
  patch: Partial<AdminEncoderConfig>
): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin.encoder.$patch({ json: patch })
  return readJson<AdminRuntimeConfig>(res)
}

export async function updateLimitsConfig(
  patch: Partial<AdminLimitsConfig>
): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin.limits.$patch({ json: patch })
  return readJson<AdminRuntimeConfig>(res)
}

export async function updateIntegrationsConfig(
  patch: Partial<AdminIntegrationsConfig>
): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin.integrations.$patch({ json: patch })
  return readJson<AdminRuntimeConfig>(res)
}

export async function fetchEncoderCapabilities(): Promise<AdminEncoderCapabilities> {
  const res = await api.api.admin.encoder.capabilities.$get()
  return readJson<AdminEncoderCapabilities>(res)
}

export async function reEncodeAllClips(): Promise<{ enqueued: number }> {
  const res = await api.api.admin.clips["re-encode"].$post()
  return readJson<{ enqueued: number }>(res)
}
