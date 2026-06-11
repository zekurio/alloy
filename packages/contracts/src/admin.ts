export type UsernameClaim = string

export const OAUTH_USERNAME_CLAIM_DEFAULT = "preferred_username"

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

export interface LoginSplashConfig {
  enabled: boolean
  blurPx: number
  darkenOpacity: number
}

export interface PublicLoginSplashConfig {
  enabled: boolean
  blurPx: number
  darkenOpacity: number
}

/**
 * Response of `GET /api/auth-config/backdrops`: a freshly-randomized set of
 * public clip IDs the login page rotates through as full-screen backdrops. The
 * client builds thumbnail URLs from these IDs (`/api/clips/:id/thumbnail`).
 */
export interface LoginBackdropsResponse {
  clipIds: string[]
}

export interface AppearanceConfig {
  loginSplash: LoginSplashConfig
}

export type AdminScheduledTaskTrigger =
  | { type: "startup"; delayMs?: number }
  | { type: "cron"; expression: string }

export type AdminScheduledTaskRunTrigger =
  | AdminScheduledTaskTrigger["type"]
  | "manual"

export type AdminScheduledTaskPayload = Record<string, unknown>

export type AdminScheduledTaskResult = Record<
  string,
  boolean | number | string | null
>

export interface AdminScheduledTaskInfo {
  id: string
  name: string
  description: string
  triggers: AdminScheduledTaskTrigger[]
  state: "idle" | "running"
  currentTrigger: AdminScheduledTaskRunTrigger | null
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastDurationMs: number | null
  lastStatus: "success" | "failed" | "cancelled" | null
  lastError: string | null
  lastResult: AdminScheduledTaskResult | null
}

export interface AdminScheduledTasksResponse {
  tasks: AdminScheduledTaskInfo[]
}

export interface AdminScheduledTaskRunResponse {
  started: boolean
  queued: boolean
  task: AdminScheduledTaskInfo
}

export interface AdminUserStorageRow {
  id: string
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
 * Secret material lives in the server-only secret store, kept separately, so
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
  scheduledTasks: Record<string, AdminScheduledTaskTrigger[]>
  limits: LimitsConfig
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
