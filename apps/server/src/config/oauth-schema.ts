import { z } from "zod"

import {
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
} from "@workspace/contracts"

const ProviderIdPattern = /^[a-z0-9-]+$/
const HexColorPattern = /^#[0-9a-fA-F]{6}$/

const OAuthProviderBaseSchema = z.object({
  providerId: z
    .string()
    .min(1)
    .max(64)
    .regex(ProviderIdPattern, "lowercase letters, digits, and dashes only"),
  displayName: z.string().min(1).max(64),
  clientId: z.string().min(1),
  clientSecret: z.string(),
  scopes: z.array(z.string().min(1)).optional(),
  enabled: z.boolean().default(true),
  buttonColor: z.string().regex(HexColorPattern).optional(),
  buttonTextColor: z.string().regex(HexColorPattern).optional(),
  iconUrl: z.string().url().optional(),
  discoveryUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  userInfoUrl: z.string().url().optional(),
  pkce: z.boolean().default(true),
  usernameClaim: z.string().min(1).max(128).default("preferred_username"),
  quotaClaim: z.string().min(1).max(128).default(OAUTH_QUOTA_CLAIM_DEFAULT),
  roleClaim: z.string().min(1).max(128).default(OAUTH_ROLE_CLAIM_DEFAULT),
})

const hasEndpoints = (p: z.infer<typeof OAuthProviderBaseSchema>) =>
  Boolean(p.discoveryUrl) || (p.authorizationUrl && p.tokenUrl && p.userInfoUrl)

const endpointsMessage =
  "Provide discoveryUrl, or all three of authorizationUrl, tokenUrl, userInfoUrl."

function validateOAuthProvider(
  provider: z.infer<typeof OAuthProviderBaseSchema>,
  ctx: z.RefinementCtx,
  requireSecret: boolean,
): void {
  if (requireSecret && provider.clientSecret.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["clientSecret"],
      message: "Client secret is required",
    })
  }

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

export const OAuthProviderSchema = OAuthProviderBaseSchema.superRefine(
  (provider, ctx) => validateOAuthProvider(provider, ctx, true),
)

export const OAuthProviderSubmissionSchema = OAuthProviderBaseSchema
  .superRefine((provider, ctx) => validateOAuthProvider(provider, ctx, false))

export const OAuthProvidersSchema = z
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

export type OAuthProviderSubmission = z.infer<
  typeof OAuthProviderSubmissionSchema
>
