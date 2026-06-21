import { z } from "zod"

import { isObjectRecord } from "./object"
import type { UserStatus } from "./shared"

export type UsernameClaim = string

export const OAUTH_USERNAME_CLAIM_DEFAULT = "preferred_username"

export const OAUTH_QUOTA_CLAIM_DEFAULT = "alloy_quota"
export const OAUTH_ROLE_CLAIM_DEFAULT = "alloy_role"

function oauthClientSecretAuthMethod<Suffix extends "post" | "basic">(
  suffix: Suffix,
): `client_secret_${Suffix}` {
  return `client_${"secret"}_${suffix}`
}

export const OAUTH_CLIENT_SECRET_POST_AUTH_METHOD =
  oauthClientSecretAuthMethod("post")
export const OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD =
  oauthClientSecretAuthMethod("basic")
export const OAUTH_TOKEN_AUTH_METHODS = [
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
] as const
export type OAuthTokenAuthMethod = (typeof OAUTH_TOKEN_AUTH_METHODS)[number]

/**
 * Stored OAuth provider metadata. Note the absence of `clientSecret`: provider
 * secrets live in the server-only secret store, never in this struct, so no
 * config read path can serialize them by accident.
 */
const NonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must be a non-empty string")

const PositiveIntegerSchema = z.number().int().positive()
const NullablePositiveIntegerSchema = PositiveIntegerSchema.nullable()
const UrlStringSchema = z.string().url()
const OptionalUrlStringSchema = UrlStringSchema.optional()

const OAuthProviderConfigFields = {
  providerId: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  clientId: NonEmptyStringSchema,
  scopes: z.array(z.string()).optional(),
  enabled: z.boolean(),
  buttonColor: z.string().optional(),
  buttonTextColor: z.string().optional(),
  iconUrl: OptionalUrlStringSchema,
  discoveryUrl: OptionalUrlStringSchema,
  authorizationUrl: OptionalUrlStringSchema,
  tokenUrl: OptionalUrlStringSchema,
  userInfoUrl: OptionalUrlStringSchema,
  pkce: z.boolean().optional(),
  tokenAuthMethod: z.enum(OAUTH_TOKEN_AUTH_METHODS).optional(),
  uidClaim: NonEmptyStringSchema.optional(),
  fetchUserInfo: z.boolean().optional(),
  authParams: z.record(z.string(), z.string()).optional(),
  usernameClaim: NonEmptyStringSchema.optional(),
  quotaClaim: NonEmptyStringSchema.optional(),
  roleClaim: NonEmptyStringSchema.optional(),
}

function requireOAuthClaimFields(
  provider: {
    quotaClaim?: string
    roleClaim?: string
  },
  ctx: z.RefinementCtx,
) {
  for (const key of ["quotaClaim", "roleClaim"] as const) {
    if (provider[key] !== undefined) continue
    ctx.addIssue({
      code: "custom",
      path: [key],
      message: `${key} is required`,
    })
  }
}

export const OAuthProviderConfigSchema = z
  .looseObject(OAuthProviderConfigFields)
  .superRefine(requireOAuthClaimFields)

export type OAuthProviderConfig = z.infer<typeof OAuthProviderConfigSchema>

/**
 * Admin-facing OAuth provider. `clientSecretSet` reports whether a secret is
 * configured (read), and `clientSecret` carries a new value when the admin is
 * setting one (write-only — it is never populated on responses).
 */
export const AdminOAuthProviderSchema = z
  .looseObject({
    ...OAuthProviderConfigFields,
    clientSecretSet: z.boolean(),
    clientSecret: z.string().optional(),
  })
  .superRefine(requireOAuthClaimFields)

export type AdminOAuthProvider = z.infer<typeof AdminOAuthProviderSchema>

export const AdminLimitsConfigSchema = z.looseObject({
  defaultStorageQuotaBytes: NullablePositiveIntegerSchema,
  uploadTtlSec: PositiveIntegerSchema,
})

export type AdminLimitsConfig = z.infer<typeof AdminLimitsConfigSchema>

export type LimitsConfig = AdminLimitsConfig

/**
 * Integrations as exposed to admins: secret values are reported only as
 * presence flags, never echoed back.
 */
export const AdminIntegrationsConfigSchema = z.looseObject({
  steamgriddbApiKeySet: z.boolean(),
  steamgriddbConfigured: z.boolean(),
})

export type AdminIntegrationsConfig = z.infer<
  typeof AdminIntegrationsConfigSchema
>

export const STORAGE_DRIVER_TYPES = ["fs"] as const
export type StorageDriverType = (typeof STORAGE_DRIVER_TYPES)[number]

export const FilesystemStorageConfigSchema = z.looseObject({
  /**
   * Filesystem root for clip sources, thumbnails, and derived media. Relative
   * paths resolve from the server working directory; absolute paths are used as-is.
   */
  clipsPath: NonEmptyStringSchema,
  /**
   * Filesystem root for user-owned assets such as avatars, banners, and
   * profile backgrounds. Relative paths resolve from the server working
   * directory; absolute paths are used as-is.
   */
  usersPath: NonEmptyStringSchema,
})

export type FilesystemStorageConfig = z.infer<
  typeof FilesystemStorageConfigSchema
>

const StorageConfigFields = {
  driver: z.enum(STORAGE_DRIVER_TYPES).default("fs"),
  fs: FilesystemStorageConfigSchema,
}

function migrateLegacyStorageConfig(value: unknown): unknown {
  if (!isObjectRecord(value)) {
    return value
  }
  if (value.fs !== undefined) {
    return {
      driver: value.driver,
      fs: value.fs,
    }
  }

  return {
    driver: value.driver,
    fs: {
      clipsPath: legacyStoragePath(value, "clips"),
      usersPath: legacyStoragePath(value, "users"),
    },
  }
}

function legacyStoragePath(
  record: Record<string, unknown>,
  namespace: "clips" | "users",
): string {
  const override = record[namespace === "clips" ? "clipsPath" : "usersPath"]
  if (typeof override === "string" && override.trim().length > 0) {
    return override
  }
  const root =
    typeof record.path === "string" && record.path.trim().length > 0
      ? record.path
      : "storage"
  return `${root.trim().replace(/[\\/]+$/, "")}/${namespace}`
}

const StorageConfigObjectSchema = z.looseObject(StorageConfigFields)

export const StorageConfigSchema = z.preprocess(
  migrateLegacyStorageConfig,
  StorageConfigObjectSchema,
)

export type StorageConfig = z.infer<typeof StorageConfigSchema>

export const AdminStorageConfigSchema = StorageConfigSchema

export type AdminStorageConfig = StorageConfig

export const LoginSplashConfigSchema = z.looseObject({
  enabled: z.boolean(),
  blurPx: z.number().nonnegative().max(48),
  darkenOpacity: z.number().nonnegative().max(1),
})

export type LoginSplashConfig = z.infer<typeof LoginSplashConfigSchema>

export interface PublicLoginSplashConfig {
  enabled: boolean
  blurPx: number
  darkenOpacity: number
}

/**
 * Response of `GET /api/auth-config/backdrops`: a freshly-randomized set of
 * public clips the login page rotates through as full-screen backdrops. `clipIds`
 * is kept for older clients; `clips` carries the thumbnail cache version.
 */
export interface LoginBackdropClip {
  id: string
  thumbVersion: string
}

export interface LoginBackdropsResponse {
  clipIds: string[]
  clips: LoginBackdropClip[]
}

export const AppearanceConfigSchema = z.looseObject({
  loginSplash: LoginSplashConfigSchema,
})

export type AppearanceConfig = z.infer<typeof AppearanceConfigSchema>

export interface AdminUserStorageRow {
  id: string
  username: string
  email: string
  image: string | null
  role: string | null
  status: UserStatus
  disabledAt: string | null
  createdAt: string
  storageQuotaBytes: number | null
  storageUsedBytes: number
  clipCount: number
}

export interface AdminUsersResponse {
  users: AdminUserStorageRow[]
}

export interface AdminUpdateUserInput {
  role?: "user" | "admin"
  status?: UserStatus
  storageQuotaBytes?: number | null
}

export const RUNTIME_CONFIG_VERSION = 1

/**
 * Secret-free server configuration as exposed through admin responses. Most
 * fields are deploy-time env/Nix config; DB-backed instance settings currently
 * cover setup completion and login appearance.
 */
export const RuntimeConfigSchema = z.looseObject({
  runtimeConfigVersion: PositiveIntegerSchema.refine(
    (value) => value === RUNTIME_CONFIG_VERSION,
    `runtimeConfigVersion must be ${RUNTIME_CONFIG_VERSION}`,
  ),
  openRegistrations: z.boolean(),
  setupComplete: z.boolean(),
  passkeyEnabled: z.boolean(),
  requireAuthToBrowse: z.boolean(),
  oauthProviders: z.array(OAuthProviderConfigSchema),
  limits: AdminLimitsConfigSchema,
  storage: StorageConfigSchema,
  appearance: AppearanceConfigSchema,
})

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>

/**
 * Admin runtime config response. Built from {@link RuntimeConfig} plus
 * secret-presence flags — it carries no secret values.
 */
export const AdminRuntimeConfigSchema = z.looseObject({
  runtimeConfigVersion: PositiveIntegerSchema.refine(
    (value) => value === RUNTIME_CONFIG_VERSION,
    `runtimeConfigVersion must be ${RUNTIME_CONFIG_VERSION}`,
  ),
  openRegistrations: z.boolean(),
  setupComplete: z.boolean(),
  passkeyEnabled: z.boolean(),
  requireAuthToBrowse: z.boolean(),
  oauthProviders: z.array(AdminOAuthProviderSchema),
  limits: AdminLimitsConfigSchema,
  storage: AdminStorageConfigSchema,
  appearance: AppearanceConfigSchema,
  integrations: AdminIntegrationsConfigSchema,
  authBaseURL: UrlStringSchema,
})

export type AdminRuntimeConfig = z.infer<typeof AdminRuntimeConfigSchema>

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
