import {
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_TOKEN_AUTH_METHODS,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"

const ProviderIdPattern = /^[a-z0-9-]+$/
const HexColorPattern = /^#?[0-9a-fA-F]{6}$/
const HexColorSchema = t
  .string()
  .trim()
  .regex(HexColorPattern, "Expected a six-digit hex color, with or without #")
  .transform((value) => (value.startsWith("#") ? value : `#${value}`))

const OAuthProviderBaseSchema = t.object({
  providerId: t
    .string()
    .min(1)
    .max(64)
    .regex(ProviderIdPattern, "lowercase letters, digits, and dashes only"),
  displayName: t.string().min(1).max(64),
  clientId: t.string().min(1),
  scopes: t.array(t.string().min(1)).optional(),
  enabled: t.boolean().$default(true),
  buttonColor: HexColorSchema.optional(),
  buttonTextColor: HexColorSchema.optional(),
  iconUrl: t.string().url().optional(),
  discoveryUrl: t.string().url().optional(),
  authorizationUrl: t.string().url().optional(),
  tokenUrl: t.string().url().optional(),
  userInfoUrl: t.string().url().optional(),
  pkce: t.boolean().$default(true),
  tokenAuthMethod: t.enum(OAUTH_TOKEN_AUTH_METHODS).optional(),
  uidClaim: t.string().min(1).max(128).$default("sub"),
  fetchUserInfo: t.boolean().$default(true),
  authParams: t.record(t.string(), t.string()).optional(),
  usernameClaim: t
    .string()
    .min(1)
    .max(128)
    .$default(OAUTH_USERNAME_CLAIM_DEFAULT),
  avatarClaim: t.string().min(1).max(128).$default(OAUTH_AVATAR_CLAIM_DEFAULT),
  quotaClaim: t.string().min(1).max(128).$default(OAUTH_QUOTA_CLAIM_DEFAULT),
  roleClaim: t.string().min(1).max(128).$default(OAUTH_ROLE_CLAIM_DEFAULT),
})

const hasEndpoints = (p: t.infer<typeof OAuthProviderBaseSchema>) =>
  Boolean(p.discoveryUrl) ||
  (p.authorizationUrl &&
    p.tokenUrl &&
    (p.userInfoUrl || p.fetchUserInfo === false))

const endpointsMessage =
  "Provide discoveryUrl, or authorizationUrl and tokenUrl plus userInfoUrl unless fetchUserInfo is false."

function validateOAuthProvider(
  provider: t.infer<typeof OAuthProviderBaseSchema>,
  ctx: t.RefinementCtx,
): void {
  if (!hasEndpoints(provider)) {
    ctx.addIssue({
      code: "custom",
      path: ["discoveryUrl"],
      message: endpointsMessage,
    })
  }
  if (!provider.usernameClaim || provider.usernameClaim.trim().length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["usernameClaim"],
      message: "Username claim is required for custom providers.",
    })
  }
}

/** Stored provider metadata (no secret — secrets live in the secret store). */
export const OAuthProviderSchema = OAuthProviderBaseSchema.superRefine(
  validateOAuthProvider,
)

/**
 * Admin submission: provider metadata plus an optional write-only
 * `clientSecret`. Absent/empty means "keep the existing secret".
 */
export const OAuthProviderSubmissionSchema = OAuthProviderBaseSchema.extend({
  clientSecret: t.string().optional(),
}).superRefine(validateOAuthProvider)

export const OAuthProvidersSchema = t
  .array(OAuthProviderSchema)
  .max(16)
  .superRefine((providers, ctx) => {
    const seen = new Set<string>()
    for (const [index, provider] of providers.entries()) {
      if (!seen.has(provider.providerId)) {
        seen.add(provider.providerId)
        continue
      }
      ctx.addIssue({
        code: "custom",
        path: [index, "providerId"],
        message: "Provider ID must be unique.",
      })
    }
  })

export type OAuthProviderSubmission = t.infer<
  typeof OAuthProviderSubmissionSchema
>
