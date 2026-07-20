import type {
  AdminOAuthProvider,
  AdminOAuthProviderInput,
  OAuthProviderPreset,
  OAuthTokenAuthMethod,
} from "@alloy/api"
import {
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
} from "@alloy/api"

export type ProviderDraft = {
  providerId: string
  displayName: string
  clientId: string
  clientSecret: string
  discoveryUrl: string
  enabled: boolean
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scopes: string
  tokenAuthMethod: OAuthTokenAuthMethod
  pkce: boolean
  uidClaim: string
  usernameClaim: string
  avatarClaim: string
  quotaClaim: string
  roleClaim: string
  buttonColor: string
  buttonTextColor: string
  iconUrl: string
}

const EMPTY_PROVIDER_DRAFT: ProviderDraft = {
  providerId: "",
  displayName: "",
  clientId: "",
  clientSecret: "",
  discoveryUrl: "",
  enabled: true,
  authorizationUrl: "",
  tokenUrl: "",
  userInfoUrl: "",
  scopes: "openid email profile",
  tokenAuthMethod: OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  pkce: true,
  uidClaim: "sub",
  usernameClaim: OAUTH_USERNAME_CLAIM_DEFAULT,
  avatarClaim: OAUTH_AVATAR_CLAIM_DEFAULT,
  quotaClaim: OAUTH_QUOTA_CLAIM_DEFAULT,
  roleClaim: OAUTH_ROLE_CLAIM_DEFAULT,
  buttonColor: "",
  buttonTextColor: "",
  iconUrl: "",
}

/**
 * Draft prefilled from a first-party preset: everything except the client
 * credentials is filled in, so the preset dialog only asks for ID + secret.
 */
export function presetToDraft(preset: OAuthProviderPreset): ProviderDraft {
  return {
    ...EMPTY_PROVIDER_DRAFT,
    providerId: preset.providerId,
    displayName: preset.displayName,
    authorizationUrl: preset.authorizationUrl,
    tokenUrl: preset.tokenUrl,
    userInfoUrl: preset.userInfoUrl,
    scopes: preset.scopes.join(" "),
    uidClaim: preset.uidClaim,
    usernameClaim: preset.usernameClaim,
    avatarClaim: preset.avatarClaim,
    buttonColor: preset.buttonColor,
    buttonTextColor: preset.buttonTextColor,
    pkce: preset.pkce,
  }
}

export function providerToDraft(
  provider: AdminOAuthProvider | null,
): ProviderDraft {
  if (!provider) return EMPTY_PROVIDER_DRAFT
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    clientId: provider.clientId,
    clientSecret: "",
    discoveryUrl: provider.discoveryUrl ?? "",
    enabled: provider.enabled,
    authorizationUrl: provider.authorizationUrl ?? "",
    tokenUrl: provider.tokenUrl ?? "",
    userInfoUrl: provider.userInfoUrl ?? "",
    scopes: provider.scopes?.join(" ") ?? "",
    tokenAuthMethod:
      provider.tokenAuthMethod ?? OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
    pkce: provider.pkce ?? true,
    uidClaim: provider.uidClaim ?? "sub",
    usernameClaim: provider.usernameClaim ?? OAUTH_USERNAME_CLAIM_DEFAULT,
    avatarClaim: provider.avatarClaim ?? OAUTH_AVATAR_CLAIM_DEFAULT,
    quotaClaim: provider.quotaClaim ?? OAUTH_QUOTA_CLAIM_DEFAULT,
    roleClaim: provider.roleClaim ?? OAUTH_ROLE_CLAIM_DEFAULT,
    buttonColor: provider.buttonColor ?? "",
    buttonTextColor: provider.buttonTextColor ?? "",
    iconUrl: provider.iconUrl ?? "",
  }
}

export function providerToInput(
  provider: AdminOAuthProvider,
): AdminOAuthProviderInput {
  return compactProviderInput({
    providerId: provider.providerId,
    displayName: provider.displayName,
    clientId: provider.clientId,
    enabled: provider.enabled,
    discoveryUrl: provider.discoveryUrl,
    authorizationUrl: provider.authorizationUrl,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl,
    scopes: provider.scopes,
    tokenAuthMethod: provider.tokenAuthMethod,
    pkce: provider.pkce,
    uidClaim: provider.uidClaim,
    usernameClaim: provider.usernameClaim,
    avatarClaim: provider.avatarClaim,
    quotaClaim: provider.quotaClaim,
    roleClaim: provider.roleClaim,
    buttonColor: provider.buttonColor,
    buttonTextColor: provider.buttonTextColor,
    iconUrl: provider.iconUrl,
  })
}

export function draftToInput(draft: ProviderDraft): AdminOAuthProviderInput {
  return compactProviderInput({
    providerId: draft.providerId.trim(),
    displayName: draft.displayName.trim(),
    clientId: draft.clientId.trim(),
    clientSecret: draft.clientSecret.trim(),
    discoveryUrl: draft.discoveryUrl.trim(),
    enabled: draft.enabled,
    authorizationUrl: draft.authorizationUrl.trim(),
    tokenUrl: draft.tokenUrl.trim(),
    userInfoUrl: draft.userInfoUrl.trim(),
    scopes: draft.scopes.trim().split(/\s+/).filter(Boolean),
    tokenAuthMethod: draft.tokenAuthMethod,
    pkce: draft.pkce,
    uidClaim: draft.uidClaim.trim(),
    usernameClaim: draft.usernameClaim.trim(),
    avatarClaim: draft.avatarClaim.trim(),
    quotaClaim: draft.quotaClaim.trim(),
    roleClaim: draft.roleClaim.trim(),
    buttonColor: draft.buttonColor.trim(),
    buttonTextColor: draft.buttonTextColor.trim(),
    iconUrl: draft.iconUrl.trim(),
  })
}

export function callbackURLForProvider(
  authBaseURL: string,
  providerId: string,
): string {
  const base = authBaseURL.endsWith("/")
    ? authBaseURL.slice(0, -1)
    : authBaseURL
  return `${base}/api/auth/oauth2/callback/${providerId.trim() || "{providerId}"}`
}

function compactProviderInput(
  provider: AdminOAuthProviderInput,
): AdminOAuthProviderInput {
  const optionalStringKeys: (keyof AdminOAuthProviderInput)[] = [
    "clientSecret",
    "discoveryUrl",
    "authorizationUrl",
    "tokenUrl",
    "userInfoUrl",
    "uidClaim",
    "usernameClaim",
    "avatarClaim",
    "quotaClaim",
    "roleClaim",
    "buttonColor",
    "buttonTextColor",
    "iconUrl",
  ]
  const next = { ...provider }
  for (const key of optionalStringKeys) {
    if (typeof next[key] === "string" && next[key].trim().length === 0) {
      delete next[key]
    }
  }
  if (next.scopes?.length === 0) delete next.scopes
  return next
}
