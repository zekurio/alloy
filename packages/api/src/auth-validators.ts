import {
  AUTH_SESSION_BROWSERS,
  AUTH_SESSION_CLIENT_KINDS,
  AUTH_SESSION_OPERATING_SYSTEMS,
  type AuthSessionSummary,
  type AuthUser,
  type ContractJsonInput,
  type LinkedAccount,
  type Passkey,
  type PendingOAuthLink,
  type SessionData,
  SyncedThemePreferencesSchema,
  type UserTheme,
  UserThemeListResponseSchema,
  UserThemeResponseSchema,
} from "@alloy/contracts"
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser"

import { booleanFlagResponseValidator } from "./contract-validators"
import { USER_ROLE_SET, USER_STATUS_SET } from "./contract-validators/shared"
import {
  objectRecord,
  validateArray,
  validateBoolean,
  validateEnumString,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNullableDateString,
  validateNullableEnumString,
  validateNullablePositiveInteger,
  validateNullableRequiredString,
  validateNullableString,
  validateRequiredString,
  validateUrlString,
} from "./runtime-validation"

export type JsonValidator<T> = (value: ContractJsonInput) => T

const AUTH_SESSION_CLIENT_KIND_SET: ReadonlySet<string> = new Set(
  AUTH_SESSION_CLIENT_KINDS,
)
const AUTH_SESSION_BROWSER_SET: ReadonlySet<string> = new Set(
  AUTH_SESSION_BROWSERS,
)
const AUTH_SESSION_OPERATING_SYSTEM_SET: ReadonlySet<string> = new Set(
  AUTH_SESSION_OPERATING_SYSTEMS,
)

export function validateAuthUser(value: ContractJsonInput): AuthUser {
  const user = objectRecord(value, "auth user")
  for (const key of ["id", "username"] as const) {
    validateRequiredString(
      user[key],
      `Invalid auth user response: ${key} is required`,
    )
  }
  validateNullableString(
    user.displayName,
    "Invalid auth user response: displayName must be string or null",
  )
  validateNullableString(
    user.image,
    "Invalid auth user response: image must be string or null",
  )
  validateNullableString(
    user.banner,
    "Invalid auth user response: banner must be string or null",
  )
  validateEnumString(
    user.role,
    USER_ROLE_SET,
    "Invalid auth user response: role is invalid",
  )
  validateEnumString(
    user.status,
    USER_STATUS_SET,
    "Invalid auth user response: status is invalid",
  )
  validateNullableDateString(
    user.disabledAt,
    "Invalid auth user response: disabledAt must be a date string or null",
  )
  validateNullablePositiveInteger(
    user.storageQuotaBytes,
    "Invalid auth user response: storageQuotaBytes must be a positive integer or null",
  )
  validateBoolean(
    user.clipAnnouncementsEnabled,
    "Invalid auth user response: clipAnnouncementsEnabled must be boolean",
  )
  if (
    user.themePreferences !== null &&
    !SyncedThemePreferencesSchema.safeParse(user.themePreferences).success
  ) {
    throw new Error(
      "Invalid auth user response: themePreferences must be theme preferences or null",
    )
  }
  validateIsoDateString(
    user.createdAt,
    "Invalid auth user response: createdAt must be a date string",
  )
  validateIsoDateString(
    user.updatedAt,
    "Invalid auth user response: updatedAt must be a date string",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as AuthUser
}

function validateSessionRow(value: ContractJsonInput): SessionData["session"] {
  const session = objectRecord(value, "auth session")
  for (const key of ["id", "userId"] as const) {
    validateRequiredString(
      session[key],
      `Invalid auth session response: ${key} is required`,
    )
  }
  validateNullableDateString(
    session.expiresAt,
    "Invalid auth session response: expiresAt must be a date string or null",
  )
  validateIsoDateString(
    session.lastSeenAt,
    "Invalid auth session response: lastSeenAt must be a date string",
  )
  validateIsoDateString(
    session.createdAt,
    "Invalid auth session response: createdAt must be a date string",
  )
  validateIsoDateString(
    session.updatedAt,
    "Invalid auth session response: updatedAt must be a date string",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as SessionData["session"]
}

export function validateSessionData(value: ContractJsonInput): SessionData {
  const sessionData = objectRecord(value, "auth session")
  validateSessionRow(sessionData.session)
  validateAuthUser(sessionData.user)
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as SessionData
}

export function validateSessionDataOrNull(
  value: ContractJsonInput,
): SessionData | null {
  if (value === null) return null
  return validateSessionData(value)
}

function validatePasskeyChallenge(value: ContractJsonInput) {
  const response = objectRecord(value, "passkey challenge")
  validateRequiredString(
    response.challengeId,
    "Invalid passkey challenge response: challengeId is required",
  )
  objectRecord(response.options, "passkey challenge options")
  return response
}

export function validatePasskeyAuthenticationOptionsResponse(
  value: ContractJsonInput,
): {
  challengeId: string
  options: PublicKeyCredentialRequestOptionsJSON
} {
  validatePasskeyChallenge(value)
  // SAFETY: The outer fields are checked here; SimpleWebAuthn validates option details.
  return value as {
    challengeId: string
    options: PublicKeyCredentialRequestOptionsJSON
  }
}

export function validatePasskeyRegistrationOptionsResponse(
  value: ContractJsonInput,
): {
  challengeId: string
  options: PublicKeyCredentialCreationOptionsJSON
} {
  validatePasskeyChallenge(value)
  // SAFETY: The outer fields are checked here; SimpleWebAuthn validates option details.
  return value as {
    challengeId: string
    options: PublicKeyCredentialCreationOptionsJSON
  }
}

export function validatePasskey(value: ContractJsonInput): Passkey {
  const passkey = objectRecord(value, "passkey")
  validateRequiredString(passkey.id, "Invalid passkey response: id is required")
  validateNullableString(
    passkey.name,
    "Invalid passkey response: name must be string or null",
  )
  validateIsoDateString(
    passkey.createdAt,
    "Invalid passkey response: createdAt must be a date string",
  )
  validateRequiredString(
    passkey.deviceType,
    "Invalid passkey response: deviceType is required",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as Passkey
}

export function validatePasskeys(value: ContractJsonInput): Passkey[] {
  return validateArray(value, "Invalid passkeys response").map(validatePasskey)
}

function validateAuthSessionSummary(
  value: ContractJsonInput,
): AuthSessionSummary {
  const session = objectRecord(value, "session")
  validateRequiredString(session.id, "Invalid session response: id is required")
  validateBoolean(
    session.current,
    "Invalid session response: current must be boolean",
  )
  validateEnumString(
    session.clientKind,
    AUTH_SESSION_CLIENT_KIND_SET,
    "Invalid session response: clientKind is invalid",
  )
  validateNullableRequiredString(
    session.deviceName,
    "Invalid session response: deviceName must be a non-empty string or null",
  )
  validateNullableEnumString(
    session.browser,
    AUTH_SESSION_BROWSER_SET,
    "Invalid session response: browser is invalid",
  )
  validateNullableEnumString(
    session.os,
    AUTH_SESSION_OPERATING_SYSTEM_SET,
    "Invalid session response: os is invalid",
  )
  validateNullableString(
    session.ipAddress,
    "Invalid session response: ipAddress must be string or null",
  )
  for (const key of ["createdAt", "lastSeenAt", "expiresAt"] as const) {
    validateIsoDateString(
      session[key],
      `Invalid session response: ${key} must be a date string`,
    )
  }
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as AuthSessionSummary
}

export function validateAuthSessionSummaries(
  value: ContractJsonInput,
): AuthSessionSummary[] {
  return validateArray(value, "Invalid sessions response").map(
    validateAuthSessionSummary,
  )
}

export function validateRevokeOtherSessionsResponse(value: ContractJsonInput): {
  revoked: number
} {
  const response = objectRecord(value, "revoke other sessions")
  validateNonNegativeInteger(
    response.revoked,
    "Invalid revoke other sessions response: revoked must be a non-negative integer",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as { revoked: number }
}

export function validateLinkedAccount(value: ContractJsonInput): LinkedAccount {
  const account = objectRecord(value, "linked account")
  for (const key of ["id", "providerId", "accountId"] as const) {
    validateRequiredString(
      account[key],
      `Invalid linked account response: ${key} is required`,
    )
  }
  validateNullableString(
    account.accountLabel,
    "Invalid linked account response: accountLabel must be string or null",
  )
  validateIsoDateString(
    account.createdAt,
    "Invalid linked account response: createdAt must be a date string",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as LinkedAccount
}

export function validateLinkedAccounts(
  value: ContractJsonInput,
): LinkedAccount[] {
  return validateArray(value, "Invalid linked accounts response").map(
    validateLinkedAccount,
  )
}

export function validateRedirectResponse(value: ContractJsonInput): {
  url: string
} {
  const response = objectRecord(value, "redirect")
  validateUrlString(
    response.url,
    "Invalid redirect response: url must be a URL",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as { url: string }
}

export function validatePendingOAuthLinkOrNull(
  value: ContractJsonInput,
): PendingOAuthLink | null {
  if (value === null) return null
  const link = objectRecord(value, "pending OAuth link")
  validateRequiredString(
    link.providerId,
    "Invalid pending OAuth link response: providerId is required",
  )
  validateNullableString(
    link.accountLabel,
    "Invalid pending OAuth link response: accountLabel must be string or null",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as PendingOAuthLink
}

export function validateUserUpdateResponse(value: ContractJsonInput): {
  user: AuthUser
} {
  const response = objectRecord(value, "update user")
  validateAuthUser(response.user)
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as { user: AuthUser }
}

export function validateUserThemeListResponse(value: ContractJsonInput): {
  themes: UserTheme[]
} {
  return UserThemeListResponseSchema.parse(value)
}

export function validateUserThemeResponse(value: ContractJsonInput): {
  theme: UserTheme
} {
  return UserThemeResponseSchema.parse(value)
}

export function validateSuccessResponse(value: ContractJsonInput): {
  success: true
} {
  return booleanFlagResponseValidator("success", true)(value)
}
