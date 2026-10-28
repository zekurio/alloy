import { t } from "./schema"

export type UsernameClaim = string

export const OAUTH_USERNAME_CLAIM_DEFAULT = "preferred_username"
export const OAUTH_AVATAR_CLAIM_DEFAULT = "picture"

export const OAUTH_QUOTA_CLAIM_DEFAULT = "alloy_quota"
export const OAUTH_ROLE_CLAIM_DEFAULT = "alloy_role"

/**
 * The ID of the server's one sign-in provider. Its callback path and every
 * linked account carry it.
 */
export const OIDC_PROVIDER_ID = "oidc"
export const OIDC_DISPLAY_NAME_DEFAULT = "SSO"
export const OIDC_SCOPES_DEFAULT = ["openid", "profile"]

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

export const NonEmptyStringSchema = t
  .string()
  .refine((value) => value.trim().length > 0, "must be a non-empty string")

export const UrlStringSchema = t.string().url()

const ClaimSchema = t.string().trim().min(1).max(128)

/**
 * The OpenID Connect provider. Every field has a default, so an unconfigured
 * server parses `{}` to a disabled provider. The client secret is not part of
 * it: secrets stay in the server's secret store, so no config read path can
 * serialize one by accident.
 */
export const OidcConfigSchema = t.object({
  enabled: t.boolean().$default(false),
  displayName: t
    .string()
    .trim()
    .min(1)
    .max(64)
    .$default(OIDC_DISPLAY_NAME_DEFAULT),
  clientId: t.string().trim().$default(""),
  /** Issuer URL or the full URL of its discovery document. */
  issuerUrl: UrlStringSchema.optional(),
  authorizationUrl: UrlStringSchema.optional(),
  tokenUrl: UrlStringSchema.optional(),
  userInfoUrl: UrlStringSchema.optional(),
  scopes: t
    .array(t.string().trim().min(1))
    .min(1)
    .max(32)
    .$default(OIDC_SCOPES_DEFAULT),
  /** Create an account on the first sign-in of an unlinked identity. */
  allowSignUp: t.boolean().$default(false),
  pkce: t.boolean().$default(true),
  tokenAuthMethod: t
    .enum(OAUTH_TOKEN_AUTH_METHODS)
    .$default(OAUTH_CLIENT_SECRET_POST_AUTH_METHOD),
  fetchUserInfo: t.boolean().$default(true),
  authParams: t.record(t.string(), t.string()).$default({}),
  uidClaim: ClaimSchema.$default("sub"),
  usernameClaim: ClaimSchema.$default(OAUTH_USERNAME_CLAIM_DEFAULT),
  avatarClaim: ClaimSchema.$default(OAUTH_AVATAR_CLAIM_DEFAULT),
  quotaClaim: ClaimSchema.$default(OAUTH_QUOTA_CLAIM_DEFAULT),
  roleClaim: ClaimSchema.$default(OAUTH_ROLE_CLAIM_DEFAULT),
})

export type OidcConfig = t.infer<typeof OidcConfigSchema>

/** The provider as the sign-in flow sees it, keyed like its linked accounts. */
export type OAuthProviderConfig = OidcConfig & { providerId: string }

export const OIDC_CLIENT_SECRET_SOURCES = ["environment", "settings"] as const
export type OidcClientSecretSource = (typeof OIDC_CLIENT_SECRET_SOURCES)[number]

/**
 * Admin-facing provider. `clientSecretSource` says where the secret in use
 * comes from, or null when there is none; the secret itself never leaves the
 * server.
 */
export const AdminOidcConfigSchema = OidcConfigSchema.extend({
  clientSecretSource: t.enum(OIDC_CLIENT_SECRET_SOURCES).nullable(),
})

export type AdminOidcConfig = t.infer<typeof AdminOidcConfigSchema>

export interface AdminAuthConfigPatch {
  openRegistrations?: boolean
  passkeyEnabled?: boolean
  requireAuthToBrowse?: boolean
}

/**
 * Admin update of the provider. `clientSecret` is write-only: a value saves a
 * new secret, null drops the saved one so the environment's applies again,
 * and absent or empty keeps it. Auth params come from ALLOY_OIDC_AUTH_PARAMS
 * only.
 */
export type AdminOidcConfigPatch = Partial<Omit<OidcConfig, "authParams">> & {
  clientSecret?: string | null
}
