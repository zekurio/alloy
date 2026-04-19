import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

import { env } from "../env"

/**
 * JSON-backed runtime config. Admin UI writes here; the on-disk file
 * survives restarts; subscribers are notified after each successful write
 * so `auth.ts` can rebuild the better-auth instance when the OAuth provider
 * changes without requiring a server restart.
 */

const ProviderIdPattern = /^[a-z0-9-]+$/

/**
 * OIDC/OAuth userinfo claims we know how to pull a username from. Not an
 * exhaustive list of everything providers emit — just the ones that make
 * sense as a human-facing handle. The generated slug is always sanitised
 * through `slugifyUsername` on the server side, so even `email` (which
 * contains `@` and a domain) ends up safe.
 */
/**
 * Common claims shown as autocomplete hints in the admin UI. Not a
 * whitelist — we accept any non-empty string so unusual OIDC providers
 * with custom claims still work.
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

const OAuthProviderBaseSchema = z.object({
  /**
   * URL-safe slug used as better-auth's `providerId` — ends up in the
   * callback URL. Changing it after users have linked accounts breaks
   * those links, so pick something durable (e.g. "sso", "keycloak").
   */
  providerId: z
    .string()
    .min(1)
    .max(64)
    .regex(ProviderIdPattern, "lowercase letters, digits, and dashes only"),
  buttonText: z.string().min(1).max(128),
  clientId: z.string().min(1),
  clientSecret: z.string(),
  scopes: z.array(z.string().min(1)).optional(),
  discoveryUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  userInfoUrl: z.string().url().optional(),
  pkce: z.boolean().default(true),
  /**
   * Which OIDC/userinfo claim should be mapped onto the user's handle on
   * first sign-in. Defaults to `preferred_username` (most common). The
   * selected claim is slugified server-side before being written.
   */
  usernameClaim: z
    .string()
    .min(1)
    .max(128)
    .default("preferred_username"),
})

const hasEndpoints = (p: z.infer<typeof OAuthProviderBaseSchema>) =>
  Boolean(p.discoveryUrl) || (p.authorizationUrl && p.tokenUrl && p.userInfoUrl)

const endpointsMessage =
  "Provide discoveryUrl, or all three of authorizationUrl, tokenUrl, userInfoUrl."

/**
 * Storage schema — what we persist and hand to better-auth. A stored
 * provider must always carry a real client secret; empty is never valid
 * on disk.
 */
export const OAuthProviderSchema = OAuthProviderBaseSchema.extend({
  clientSecret: z.string().min(1),
}).refine(hasEndpoints, { message: endpointsMessage })

/**
 * Admin-submission schema — accepts an empty `clientSecret`, which the
 * route handler interprets as "keep the currently stored secret". Most
 * IdPs rotate secrets only occasionally, so re-entering one on every
 * settings change is a papercut.
 */
export const OAuthProviderSubmissionSchema = OAuthProviderBaseSchema.refine(
  hasEndpoints,
  { message: endpointsMessage }
)

export type OAuthProviderConfig = z.infer<typeof OAuthProviderSchema>
export type OAuthProviderSubmission = z.infer<
  typeof OAuthProviderSubmissionSchema
>

/**
 * Hardware-acceleration backend ffmpeg should use for the encode pass.
 * Each value selects a different codec family + flag set:
 *
 *   - `software` → libx264/libx265, CRF-based, runs on any host. Slowest
 *     but the most portable; the safe default for unknown hardware.
 *   - `nvenc`    → NVIDIA. h264_nvenc / hevc_nvenc, CQ-based VBR. Needs
 *     the NVIDIA driver + CUDA in the container.
 *   - `qsv`      → Intel Quick Sync. Needs `/dev/dri/renderD128` and
 *     iHD/i965 driver. Maps quality onto `global_quality`.
 *   - `amf`      → AMD AMF. Windows-first; on Linux requires AMDGPU-PRO.
 *     Maps quality onto a constant-QP rate-control.
 *   - `vaapi`    → VA-API on `/dev/dri/renderD128`. Cross-vendor (Intel,
 *     AMD on amdgpu, sometimes NVIDIA via nouveau). Maps quality onto qp.
 *
 * Capability detection at `/api/admin/encoder/capabilities` runs
 * `ffmpeg -encoders` so the admin UI can grey out backends the host
 * binary wasn't compiled with.
 */
export const HWACCEL_KINDS = [
  "software",
  "nvenc",
  "qsv",
  "amf",
  "vaapi",
] as const
export type HwaccelKind = (typeof HWACCEL_KINDS)[number]

export const ENCODER_CODECS = ["h264", "hevc"] as const
export type EncoderCodec = (typeof ENCODER_CODECS)[number]

/**
 * Allowed output heights. We snap to common ladder steps so the UI is a
 * dropdown (not a free-form number) and so encode args never end up
 * with weird oddly-divisible values that some hwaccel encoders refuse.
 */
export const ENCODER_TARGET_HEIGHTS = [
  360, 480, 720, 1080, 1440, 2160,
] as const
export type EncoderTargetHeight = (typeof ENCODER_TARGET_HEIGHTS)[number]

/**
 * Encode pipeline knobs. Lives in runtime config (not env) because admins
 * routinely retune these — quality vs size, target rendition, swap
 * software/hwaccel after installing a GPU. Changes apply to the *next*
 * encode job; jobs already in flight finish on whatever config they
 * were dispatched with (the worker reads config once per job).
 */
const EncoderConfigSchema = z.object({
  hwaccel: z.enum(HWACCEL_KINDS).default("software"),
  codec: z.enum(ENCODER_CODECS).default("h264"),
  /**
   * Unified quality scale 0–51. Each encoder maps it onto its native
   * knob: libx264/x265 CRF, NVENC CQ, QSV global_quality, AMF qp_i/qp_p,
   * VAAPI qp. 23 is a sane "visually lossless-ish" default across all
   * of them.
   */
  quality: z.number().int().min(0).max(51).default(23),
  /**
   * Encoder-specific preset name. We accept any string and let ffmpeg
   * fail loudly with `failureReason` populated so admins can recover —
   * the alternative is per-encoder enums that drift out of sync as
   * codec versions change. Suggestions in the admin UI cover the
   * common names per backend.
   */
  preset: z.string().min(1).max(64).default("medium"),
  targetHeight: z
    .union([
      z.literal(360),
      z.literal(480),
      z.literal(720),
      z.literal(1080),
      z.literal(1440),
      z.literal(2160),
    ])
    .default(1080),
  audioBitrateKbps: z.number().int().min(64).max(320).default(128),
  /**
   * Path to the VA-API render node. Only consulted when `hwaccel = vaapi`.
   * Defaults to the conventional first-GPU node; admins with multiple
   * GPUs can point at /dev/dri/renderD129 etc.
   */
  vaapiDevice: z.string().min(1).max(128).default("/dev/dri/renderD128"),
})

export type EncoderConfig = z.infer<typeof EncoderConfigSchema>

/**
 * Upload + queue limits. Same hot-reload semantics as `encoder` —
 * `maxUploadBytes` and `uploadTtlSec` apply to the next `/initiate`
 * call; `queueConcurrency` is registered with pg-boss at boot and
 * needs a server restart to change (the admin UI calls this out).
 */
const LimitsConfigSchema = z.object({
  maxUploadBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024 * 1024) // 64 GiB hard ceiling — anything larger
    // is almost certainly a misconfig and will crush the disk first.
    .default(4 * 1024 * 1024 * 1024),
  uploadTtlSec: z
    .number()
    .int()
    .min(60)
    .max(24 * 60 * 60)
    .default(900),
  queueConcurrency: z.number().int().min(1).max(16).default(1),
})

export type LimitsConfig = z.infer<typeof LimitsConfigSchema>

const RuntimeConfigSchema = z.object({
  openRegistrations: z.boolean().default(false),
  setupComplete: z.boolean().default(false),
  /**
   * Master switch for the email/password sign-in surface. When false the
   * login page hides the form and better-auth rejects both `/sign-in/email`
   * and `/sign-up/email`. Defaults to true so first-run setup keeps working
   * — admins can disable it once an OAuth provider is wired up and they
   * have themselves a linked OAuth account.
   */
  emailPasswordEnabled: z.boolean().default(true),
  oauthProvider: OAuthProviderSchema.nullable().default(null),
  // Defaulting via `.parse({})` populates the nested objects so existing
  // installs without an `encoder`/`limits` block in their config file
  // pick up sensible values on the next read.
  encoder: EncoderConfigSchema.default(EncoderConfigSchema.parse({})),
  limits: LimitsConfigSchema.default(LimitsConfigSchema.parse({})),
})

export const EncoderConfigPatchSchema = EncoderConfigSchema.partial()
export const LimitsConfigPatchSchema = LimitsConfigSchema.partial()

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>

const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({})

function resolveConfigPath(): string {
  if (env.RUNTIME_CONFIG_PATH && env.RUNTIME_CONFIG_PATH.length > 0) {
    return path.resolve(env.RUNTIME_CONFIG_PATH)
  }
  return path.resolve(process.cwd(), "data/runtime-config.json")
}

const CONFIG_PATH = resolveConfigPath()

function loadFromDisk(): RuntimeConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG }
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8")
    const json = JSON.parse(raw) as unknown
    const result = RuntimeConfigSchema.safeParse(json)
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.warn(
        `[config-store] ${CONFIG_PATH} failed validation, falling back to defaults:`,
        JSON.stringify(result.error.flatten())
      )
      return { ...DEFAULT_CONFIG }
    }
    return result.data
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config-store] failed to read ${CONFIG_PATH}, falling back to defaults:`,
      err instanceof Error ? err.message : err
    )
    return { ...DEFAULT_CONFIG }
  }
}

function writeToDisk(next: RuntimeConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${CONFIG_PATH}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8")
  fs.renameSync(tmpPath, CONFIG_PATH)
}

let state: RuntimeConfig = loadFromDisk()

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>
) => void
const listeners = new Set<Listener>()

function commit(next: RuntimeConfig): void {
  const prev = state
  writeToDisk(next)
  state = next
  for (const listener of listeners) {
    try {
      listener(state, prev)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[config-store] listener threw:", err)
    }
  }
}

export interface ConfigStore {
  get<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K]
  getAll(): Readonly<RuntimeConfig>
  set<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]): void
  patch(patch: Partial<RuntimeConfig>): void
  subscribe(fn: Listener): () => void
  readonly filePath: string
}

export const configStore: ConfigStore = {
  get(key) {
    return state[key]
  },
  getAll() {
    return { ...state }
  },
  set(key, value) {
    commit(RuntimeConfigSchema.parse({ ...state, [key]: value }))
  },
  patch(patch) {
    commit(RuntimeConfigSchema.parse({ ...state, ...patch }))
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get filePath() {
    return CONFIG_PATH
  },
}
