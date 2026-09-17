import { t } from "./schema"

export type UsernameClaim = string

export const OAUTH_USERNAME_CLAIM_DEFAULT = "preferred_username"
export const OAUTH_AVATAR_CLAIM_DEFAULT = "picture"

export const OAUTH_QUOTA_CLAIM_DEFAULT = "alloy_quota"
export const OAUTH_ROLE_CLAIM_DEFAULT = "alloy_role"

function oauthClientSecretAuthMethod<Suffix extends "post" | "basic">(
  suffix: Suffix,
): `client_secret_${Suffix}` {
  return `client_${"secret"}_${suffix}`
}

/**
 * Managed OAuth provider icons are ingested into Alloy's asset storage and
 * served from this same-origin path. Keys are versioned per upload, so the
 * serving route can cache immutably and replaced icons can be deleted safely.
 */
export const OAUTH_PROVIDER_ICON_PATH_PREFIX = "/api/assets/auth/"

export const OAUTH_PROVIDER_ICON_KEY_RE =
  /^providers\/[a-z0-9-]{1,64}\/icon-[0-9a-f]{32}\.webp$/

export function oauthProviderIconPath(key: string): string {
  return `${OAUTH_PROVIDER_ICON_PATH_PREFIX}${key}`
}

/**
 * Extract the storage key from a managed provider icon URL, or null when the
 * value is anything else (external URL or malformed path).
 */
export function managedOAuthProviderIconKey(
  iconUrl: string | null | undefined,
): string | null {
  if (!iconUrl) return null
  const base = iconUrl.split("?", 1)[0] ?? ""
  if (!base.startsWith(OAUTH_PROVIDER_ICON_PATH_PREFIX)) return null
  const key = base.slice(OAUTH_PROVIDER_ICON_PATH_PREFIX.length)
  return OAUTH_PROVIDER_ICON_KEY_RE.test(key) ? key : null
}

/**
 * The icon URL a browser may be given for a login button. Only Alloy-managed
 * same-origin paths cross this boundary.
 */
export function publicOAuthProviderIconUrl(
  iconUrl: string | undefined,
): string | undefined {
  if (!iconUrl) return undefined
  if (managedOAuthProviderIconKey(iconUrl)) return iconUrl
  return undefined
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
const NonEmptyStringSchema = t
  .string()
  .refine((value) => value.trim().length > 0, "must be a non-empty string")

const OptionalUrlStringSchema = t.string().url().optional()

const UrlStringSchema = t.string().url()

// Absolute source URL or an Alloy-managed icon path. The admin ingestion
// boundary later restricts new source URLs to public http(s) images.
const OAuthProviderIconUrlSchema = t
  .string()
  .refine(
    (value) =>
      managedOAuthProviderIconKey(value) !== null ||
      UrlStringSchema.safeParse(value).success,
    "must be a URL or a managed provider icon path",
  )
  .optional()

const OAuthProviderConfigFields = {
  providerId: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  clientId: NonEmptyStringSchema,
  scopes: t.array(t.string()).optional(),
  enabled: t.boolean(),
  buttonColor: t.string().optional(),
  buttonTextColor: t.string().optional(),
  iconUrl: OAuthProviderIconUrlSchema,
  discoveryUrl: OptionalUrlStringSchema,
  authorizationUrl: OptionalUrlStringSchema,
  tokenUrl: OptionalUrlStringSchema,
  userInfoUrl: OptionalUrlStringSchema,
  pkce: t.boolean().optional(),
  tokenAuthMethod: t.enum(OAUTH_TOKEN_AUTH_METHODS).optional(),
  uidClaim: NonEmptyStringSchema.optional(),
  fetchUserInfo: t.boolean().optional(),
  authParams: t.record(t.string(), t.string()).optional(),
  usernameClaim: NonEmptyStringSchema.optional(),
  avatarClaim: NonEmptyStringSchema.optional(),
  quotaClaim: NonEmptyStringSchema.optional(),
  roleClaim: NonEmptyStringSchema.optional(),
}

function requireOAuthClaimFields(
  provider: {
    quotaClaim?: string
    roleClaim?: string
  },
  ctx: t.RefinementCtx,
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

export const OAuthProviderConfigSchema = t
  .looseObject(OAuthProviderConfigFields)
  .superRefine(requireOAuthClaimFields)

export type OAuthProviderConfig = t.infer<typeof OAuthProviderConfigSchema>

/**
 * Admin-facing OAuth provider. `clientSecretSet` reports whether a secret is
 * configured (read), and `clientSecret` carries a new value when the admin is
 * setting one (write-only — it is never populated on responses).
 */
export const AdminOAuthProviderSchema = t
  .looseObject({
    ...OAuthProviderConfigFields,
    clientSecretSet: t.boolean(),
    clientSecret: t.string().optional(),
  })
  .superRefine(requireOAuthClaimFields)

export type AdminOAuthProvider = t.infer<typeof AdminOAuthProviderSchema>

/**
 * Which auth config sections are env-managed. A locked key is sourced from its
 * ALLOY_* environment variable and rejects admin writes until the variable is
 * unset (Immich-style declarative override).
 */
export const AuthConfigLocksSchema = t.looseObject({
  openRegistrations: t.boolean(),
  passkeyEnabled: t.boolean(),
  requireAuthToBrowse: t.boolean(),
  oauthProviders: t.boolean(),
})

export type AuthConfigLocks = t.infer<typeof AuthConfigLocksSchema>

export interface AdminAuthConfigPatch {
  openRegistrations?: boolean
  passkeyEnabled?: boolean
  requireAuthToBrowse?: boolean
}

/**
 * Admin submission shape for the OAuth provider list. `clientSecret` is
 * write-only; absent or empty keeps the provider's stored secret. Fields with
 * server-side defaults (claims, pkce, uidClaim, ...) may be omitted.
 */
export type AdminOAuthProviderInput = Partial<OAuthProviderConfig> & {
  providerId: string
  displayName: string
  clientId: string
  enabled: boolean
  clientSecret?: string
}
