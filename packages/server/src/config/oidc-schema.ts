import { OidcConfigSchema, type OidcConfig } from "@alloy/contracts"
import type { t } from "@alloy/contracts/schema"

function hasEndpoints(config: OidcConfig): boolean {
  return (
    Boolean(config.issuerUrl) ||
    Boolean(
      config.authorizationUrl &&
      config.tokenUrl &&
      (config.userInfoUrl || !config.fetchUserInfo),
    )
  )
}

function validateOidcConfig(config: OidcConfig, ctx: t.RefinementCtx): void {
  // A disabled provider may be half filled in; it only has to be complete
  // once sign-in can reach it.
  if (!config.enabled) return
  if (!config.clientId) {
    ctx.addIssue({
      code: "custom",
      path: ["clientId"],
      message: "Enter a client ID before enabling sign-in.",
    })
  }
  if (!hasEndpoints(config)) {
    ctx.addIssue({
      code: "custom",
      path: ["issuerUrl"],
      message:
        "Provide an issuer URL, or an authorization URL and token URL plus a user info URL unless fetching user info is off.",
    })
  }
}

/** The provider with the rules that span fields, as the server saves it. */
export const OidcSettingsSchema =
  OidcConfigSchema.superRefine(validateOidcConfig)
