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
  validateNullableString,
  validateOptionalUrlString,
  validateRequiredString,
} from "@alloy/api/runtime-validation"
import {
  type AdminUsersResponse,
  type AdminUserStorageRow,
  type LoginBackdropsResponse,
  type ProfileCounts,
  type PublicDesktopAuthConfig,
  type ProfileGameRow,
  type ProfileViewer,
  type PublicAuthConfig,
  type PublicAuthProvider,
  type PublicLoginSplashConfig,
  type PublicUser,
  USER_ROLES,
  USER_STATUSES,
  type UserProfile,
  type UserProfileViewer,
  type UserStorageUsage,
} from "@alloy/contracts"

import type { ApiJsonInput } from "../json-value"
import {
  validateAuthProviderColors,
  validateBackdropTreatment,
  validateGameRowFields,
} from "./shared"
const PUBLIC_AUTH_BOOLEAN_FIELDS = [
  "openRegistrations",
  "passkeyEnabled",
  "requireAuthToBrowse",
] as const
const USER_ROLE_SET: ReadonlySet<string> = new Set(USER_ROLES)
const USER_STATUS_SET: ReadonlySet<string> = new Set(USER_STATUSES)
function validatePublicAuthProvider(value: ApiJsonInput): PublicAuthProvider {
  const provider = objectRecord(value, "auth provider")
  for (const key of ["providerId", "displayName"] as const) {
    validateRequiredString(
      provider[key],
      `Invalid auth config response: provider.${key} is required`,
    )
  }
  validateAuthProviderColors(provider, "auth config response: provider")
  validateOptionalUrlString(
    provider.iconUrl,
    "Invalid auth config response: provider.iconUrl must be a URL",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as PublicAuthProvider
}

function validatePublicDesktopAuthConfig(
  value: ApiJsonInput,
): PublicDesktopAuthConfig {
  const desktopAuth = objectRecord(value, "auth config desktopAuth")
  validateNonNegativeInteger(
    desktopAuth.version,
    "Invalid auth config response: desktopAuth.version must be a non-negative integer",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as PublicDesktopAuthConfig
}

function validatePublicLoginSplashConfig(
  value: ApiJsonInput,
): PublicLoginSplashConfig {
  const splash = objectRecord(value, "login splash")
  validateBoolean(
    splash.enabled,
    "Invalid auth config response: loginSplash.enabled must be boolean",
  )
  validateBackdropTreatment(splash, "auth config response")
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as PublicLoginSplashConfig
}

export function validateLoginBackdropsResponse(
  value: ApiJsonInput,
): LoginBackdropsResponse {
  const response = objectRecord(value, "login backdrops response")
  validateArray(
    response.clips,
    "Invalid login backdrops response: clips must be an array",
  ).map((item) => {
    const clip = objectRecord(item, "login backdrop clip")
    validateRequiredString(
      clip.id,
      "Invalid login backdrops response: clip id is required",
    )
    validateRequiredString(
      clip.thumbVersion,
      "Invalid login backdrops response: thumbVersion is required",
    )
  })
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as LoginBackdropsResponse
}

export function validatePublicAuthConfig(
  value: ApiJsonInput,
): PublicAuthConfig {
  const config = objectRecord(value, "auth config")
  for (const key of ["adminAccountRequired", "setupRequired"] as const) {
    validateBoolean(
      config[key],
      `Invalid auth config response: ${key} must be boolean`,
    )
  }
  for (const key of PUBLIC_AUTH_BOOLEAN_FIELDS) {
    validateBoolean(
      config[key],
      `Invalid auth config response: ${key} must be boolean`,
    )
  }
  validateArray(
    config.providers,
    "Invalid auth config response: providers must be an array",
  ).map(validatePublicAuthProvider)
  validatePublicLoginSplashConfig(config.loginSplash)
  validatePublicDesktopAuthConfig(config.desktopAuth)
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as PublicAuthConfig
}

export function validateAdminUserStorageRow(
  value: ApiJsonInput,
): AdminUserStorageRow {
  const row = objectRecord(value, "admin user")
  for (const key of ["id", "username", "createdAt"] as const) {
    validateRequiredString(
      row[key],
      `Invalid admin user response: ${key} is required`,
    )
  }
  validateIsoDateString(
    row.createdAt,
    "Invalid admin user response: createdAt must be a date string",
  )
  validateNullableString(
    row.image,
    "Invalid admin user response: image must be string or null",
  )
  validateNullableEnumString(
    row.role,
    USER_ROLE_SET,
    "Invalid admin user response: role is invalid",
  )
  validateEnumString(
    row.status,
    USER_STATUS_SET,
    "Invalid admin user response: status is invalid",
  )
  validateNullableDateString(
    row.disabledAt,
    "Invalid admin user response: disabledAt must be a date string or null",
  )
  if (row.adminSuspendedAt !== undefined) {
    validateNullableDateString(
      row.adminSuspendedAt,
      "Invalid admin user response: adminSuspendedAt must be a date string or null",
    )
  }
  validateNullablePositiveInteger(
    row.storageQuotaBytes,
    "Invalid admin user response: storageQuotaBytes must be a positive integer or null",
  )
  validateNonNegativeInteger(
    row.storageUsedBytes,
    "Invalid admin user response: storageUsedBytes must be a non-negative integer",
  )
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid admin user response: clipCount must be a non-negative integer",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as AdminUserStorageRow
}

export function validateAdminUsersResponse(
  value: ApiJsonInput,
): AdminUsersResponse {
  const response = objectRecord(value, "admin users")
  validateArray(
    response.users,
    "Invalid admin users response: users must be an array",
  ).map(validateAdminUserStorageRow)
  validateNullableString(
    response.nextCursor,
    "Invalid admin users response: nextCursor must be a string or null",
  )
  validateNonNegativeInteger(
    response.total,
    "Invalid admin users response: total must be a non-negative integer",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as AdminUsersResponse
}

export function validatePublicUser(value: ApiJsonInput): PublicUser {
  const row = objectRecord(value, "user")
  for (const key of ["id", "username", "createdAt", "updatedAt"] as const) {
    validateRequiredString(
      row[key],
      `Invalid user response: ${key} is required`,
    )
  }
  validateNullableString(
    row.image,
    "Invalid user response: image must be string or null",
  )
  validateNullableString(
    row.banner,
    "Invalid user response: banner must be string or null",
  )
  validateIsoDateString(
    row.createdAt,
    "Invalid user response: createdAt must be a date string",
  )
  validateIsoDateString(
    row.updatedAt,
    "Invalid user response: updatedAt must be a date string",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as PublicUser
}

function validateProfileCounts(value: ApiJsonInput): ProfileCounts {
  const counts = objectRecord(value, "profile counts")
  validateNonNegativeInteger(
    counts.clips,
    "Invalid profile counts response: clips must be a non-negative integer",
  )
  validateNonNegativeInteger(
    counts.screenshots,
    "Invalid profile counts response: screenshots must be a non-negative integer",
  )
  validateNonNegativeInteger(
    counts.games,
    "Invalid profile counts response: games must be a non-negative integer",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as ProfileCounts
}

function validateProfileViewer(value: ApiJsonInput): ProfileViewer {
  const viewer = objectRecord(value, "profile viewer")
  for (const key of ["isSelf", "isBlocked", "isBlockedBy"] as const) {
    validateBoolean(
      viewer[key],
      `Invalid profile viewer response: ${key} must be boolean`,
    )
  }
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as ProfileViewer
}

export function validateUserProfile(value: ApiJsonInput): UserProfile {
  const profile = objectRecord(value, "user profile")
  validatePublicUser(profile.user)
  validateProfileCounts(profile.counts)
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as UserProfile
}

export function validateUserProfileViewer(
  value: ApiJsonInput,
): UserProfileViewer {
  const response = objectRecord(value, "profile viewer")
  if (response.viewer !== null) validateProfileViewer(response.viewer)
  if (response.counts !== null) validateProfileCounts(response.counts)
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as UserProfileViewer
}

function validateProfileGameRow(value: ApiJsonInput): ProfileGameRow {
  const row = objectRecord(value, "profile game")
  validateGameRowFields(row, "profile game")
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid profile game response: clipCount must be a non-negative integer",
  )
  validateIsoDateString(
    row.lastClippedAt,
    "Invalid profile game response: lastClippedAt must be a date string",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as ProfileGameRow
}

export function validateProfileGameRows(value: ApiJsonInput): ProfileGameRow[] {
  return validateArray(value, "Invalid profile games response").map(
    validateProfileGameRow,
  )
}

export function validateUserStorageUsage(
  value: ApiJsonInput,
): UserStorageUsage {
  const usage = objectRecord(value, "storage usage")
  validateNonNegativeInteger(
    usage.usedBytes,
    "Invalid storage usage response: usedBytes must be a non-negative integer",
  )
  validateNullablePositiveInteger(
    usage.quotaBytes,
    "Invalid storage usage response: quotaBytes must be a positive integer or null",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as UserStorageUsage
}
