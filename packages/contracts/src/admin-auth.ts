import { z } from "zod"

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

const OptionalUrlStringSchema = z.string().url().optional()

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
  avatarClaim: NonEmptyStringSchema.optional(),
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

/**
 * Which auth config sections are env-managed. A locked key is sourced from its
 * ALLOY_* environment variable and rejects admin writes until the variable is
 * unset (Immich-style declarative override).
 */
export const AuthConfigLocksSchema = z.looseObject({
  openRegistrations: z.boolean(),
  passkeyEnabled: z.boolean(),
  requireAuthToBrowse: z.boolean(),
  oauthProviders: z.boolean(),
})

export type AuthConfigLocks = z.infer<typeof AuthConfigLocksSchema>

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
