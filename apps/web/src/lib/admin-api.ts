import { api } from "./api"

/**
 * Common userinfo/OIDC claims surfaced as suggestions in the admin UI.
 * The field itself accepts any non-empty string — weird providers exist
 * and the server just reads `profile[claim]` — so this is autocomplete
 * hints, not a whitelist. Kept loosely in sync with
 * `USERNAME_CLAIM_SUGGESTIONS` in `apps/server/src/lib/config-store.ts`.
 */
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

/** Mirror of `OAuthProviderConfig` on the server (see lib/config-store.ts). */
export interface AdminOAuthProvider {
  providerId: string
  buttonText: string
  clientId: string
  /** Always empty on read; admins re-enter on every save. */
  clientSecret: string
  scopes?: string[]
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  pkce?: boolean
  usernameClaim?: UsernameClaim
}

/**
 * Encoder backend choices. Mirrors `HWACCEL_KINDS` in
 * `apps/server/src/lib/config-store.ts`. Use the schema docstring there
 * for the per-backend flag rationale; this file just types the wire.
 */
export const ENCODER_HWACCELS = [
  "software",
  "nvenc",
  "qsv",
  "amf",
  "vaapi",
] as const
export type EncoderHwaccel = (typeof ENCODER_HWACCELS)[number]

export const ENCODER_CODECS = ["h264", "hevc"] as const
export type EncoderCodec = (typeof ENCODER_CODECS)[number]

export const ENCODER_TARGET_HEIGHTS = [
  360, 480, 720, 1080, 1440, 2160,
] as const
export type EncoderTargetHeight = (typeof ENCODER_TARGET_HEIGHTS)[number]

export interface AdminEncoderConfig {
  hwaccel: EncoderHwaccel
  codec: EncoderCodec
  /** 0–51, mapped to CRF/CQ/global_quality/qp depending on backend. */
  quality: number
  /** Encoder-specific preset name. Suggestions per backend in the UI. */
  preset: string
  targetHeight: EncoderTargetHeight
  audioBitrateKbps: number
  /** VA-API render node path. Only used when `hwaccel === "vaapi"`. */
  vaapiDevice: string
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

/**
 * Encoder capability matrix returned by
 * `GET /api/admin/encoder/capabilities`. The admin UI uses this to grey
 * out backends the host's ffmpeg wasn't compiled with.
 */
export interface AdminEncoderCapabilities {
  ffmpegOk: boolean
  ffmpegVersion: string | null
  available: Record<EncoderHwaccel, { h264: boolean; hevc: boolean }>
}

export interface AdminRuntimeConfig {
  openRegistrations: boolean
  setupComplete: boolean
  emailPasswordEnabled: boolean
  oauthProvider: AdminOAuthProvider | null
  encoder: AdminEncoderConfig
  limits: AdminLimitsConfig
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
}): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["runtime-config"].$patch({ json: input })
  return readJson<AdminRuntimeConfig>(res)
}

export async function saveOAuthProvider(
  provider: AdminOAuthProvider
): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["oauth-provider"].$put({ json: provider })
  return readJson<AdminRuntimeConfig>(res)
}

export async function deleteOAuthProvider(): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["oauth-provider"].$delete()
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

export async function fetchEncoderCapabilities(): Promise<AdminEncoderCapabilities> {
  const res = await api.api.admin.encoder.capabilities.$get()
  return readJson<AdminEncoderCapabilities>(res)
}
