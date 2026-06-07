import {
  type AdminUsersResponse,
  type AdminUserStorageRow,
  type CommentPage,
  type CommentRow,
  type ProfileCounts,
  type PublicDesktopAuthConfig,
  type ProfileGameRow,
  type ProfileViewer,
  type PublicAuthConfig,
  type PublicAuthProvider,
  type PublicLoginSplashConfig,
  type PublicUser,
  USER_ROLES,
  type UserProfile,
  type UserProfileViewer,
  type UserStorageUsage,
} from "alloy-contracts"

import {
  objectRecord,
  validateArray,
  validateBoolean,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNullableDateString,
  validateNullableEnumString,
  validateNullablePositiveInteger,
  validateNullableRequiredString,
  validateNullableString,
  validateOptionalUrlString,
  validateRequiredString,
  validateString,
} from "../runtime-validation"
import { validateUserSummary } from "./people-notifications"
import {
  validateAuthProviderColors,
  validateBackdropTreatment,
  validateGameRowFields,
  validateLikeState,
} from "./shared"
const PUBLIC_AUTH_BOOLEAN_FIELDS = [
  "openRegistrations",
  "passkeyEnabled",
  "requireAuthToBrowse",
] as const
const USER_ROLE_SET: ReadonlySet<string> = new Set(USER_ROLES)
function validatePublicAuthProvider(value: unknown): PublicAuthProvider {
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
  return value as PublicAuthProvider
}

function validatePublicDesktopAuthConfig(
  value: unknown,
): PublicDesktopAuthConfig {
  const desktopAuth = objectRecord(value, "auth config desktopAuth")
  validateNonNegativeInteger(
    desktopAuth.version,
    "Invalid auth config response: desktopAuth.version must be a non-negative integer",
  )
  return value as PublicDesktopAuthConfig
}

function validatePublicLoginSplashConfig(
  value: unknown,
): PublicLoginSplashConfig {
  const splash = objectRecord(value, "login splash")
  validateBoolean(
    splash.enabled,
    "Invalid auth config response: loginSplash.enabled must be boolean",
  )
  validateBackdropTreatment(splash, "auth config response")
  validateNullableString(
    splash.imageUrl,
    "Invalid auth config response: loginSplash.imageUrl must be string or null",
  )
  return value as PublicLoginSplashConfig
}

export function validatePublicAuthConfig(value: unknown): PublicAuthConfig {
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
  return value as PublicAuthConfig
}

export function validateAdminUserStorageRow(
  value: unknown,
): AdminUserStorageRow {
  const row = objectRecord(value, "admin user")
  for (const key of ["id", "username", "email", "createdAt"] as const) {
    validateRequiredString(
      row[key],
      `Invalid admin user response: ${key} is required`,
    )
  }
  validateIsoDateString(
    row.createdAt,
    "Invalid admin user response: createdAt must be a date string",
  )
  validateString(row.name, "Invalid admin user response: name is required")
  validateNullableString(
    row.image,
    "Invalid admin user response: image must be string or null",
  )
  validateNullableEnumString(
    row.role,
    USER_ROLE_SET,
    "Invalid admin user response: role is invalid",
  )
  validateNullablePositiveInteger(
    row.storageQuotaBytes,
    "Invalid admin user response: storageQuotaBytes must be a positive integer or null",
  )
  validateNonNegativeInteger(
    row.storageUsedBytes,
    "Invalid admin user response: storageUsedBytes must be a non-negative integer",
  )
  return value as AdminUserStorageRow
}

export function validateAdminUsersResponse(value: unknown): AdminUsersResponse {
  const response = objectRecord(value, "admin users")
  validateArray(
    response.users,
    "Invalid admin users response: users must be an array",
  ).map(validateAdminUserStorageRow)
  return value as AdminUsersResponse
}

export function validateCommentRow(value: unknown): CommentRow {
  const row = objectRecord(value, "comment")
  for (const key of ["id", "clipId"] as const) {
    validateRequiredString(
      row[key],
      `Invalid comment response: ${key} is required`,
    )
  }
  validateString(row.body, "Invalid comment response: body is required")
  validateNullableString(
    row.parentId,
    "Invalid comment response: parentId must be string or null",
  )
  validateNonNegativeInteger(
    row.likeCount,
    "Invalid comment response: likeCount must be a non-negative integer",
  )
  for (const key of ["pinned", "likedByViewer", "likedByAuthor"] as const) {
    validateBoolean(
      row[key],
      `Invalid comment response: ${key} must be boolean`,
    )
  }
  validateIsoDateString(
    row.createdAt,
    "Invalid comment response: createdAt must be a date string",
  )
  for (const key of ["pinnedAt", "editedAt"] as const) {
    validateNullableDateString(
      row[key],
      `Invalid comment response: ${key} must be a date string or null`,
    )
  }
  validateUserSummary(row.author, "comment author")
  validateArray(
    row.replies,
    "Invalid comment response: replies must be an array",
  ).map(validateCommentRow)
  return value as CommentRow
}

export function validateCommentPage(value: unknown): CommentPage {
  const page = objectRecord(value, "comments")
  validateArray(
    page.items,
    "Invalid comments response: items must be an array",
  ).map(validateCommentRow)
  validateNullableRequiredString(
    page.nextCursor,
    "Invalid comments response: nextCursor must be a non-empty string or null",
  )
  return value as CommentPage
}

export function validateCommentUpdateResponse(value: unknown): {
  id: string
  body: string
  editedAt: string | null
} {
  const row = objectRecord(value, "comment update")
  for (const key of ["id", "body"] as const) {
    validateRequiredString(
      row[key],
      `Invalid comment update response: ${key} is required`,
    )
  }
  validateNullableDateString(
    row.editedAt,
    "Invalid comment update response: editedAt must be a date string or null",
  )
  return value as { id: string; body: string; editedAt: string | null }
}

export function validateCommentLikeState(value: unknown): {
  liked: boolean
  likeCount: number
} {
  validateLikeState(value, "comment")
  return value as { liked: boolean; likeCount: number }
}

export function validatePublicUser(value: unknown): PublicUser {
  const row = objectRecord(value, "user")
  for (const key of ["id", "username", "createdAt", "updatedAt"] as const) {
    validateRequiredString(
      row[key],
      `Invalid user response: ${key} is required`,
    )
  }
  validateString(row.name, "Invalid user response: name is required")
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
  return value as PublicUser
}

function validateProfileCounts(value: unknown): ProfileCounts {
  const counts = objectRecord(value, "profile counts")
  for (const key of ["clips", "followers", "following"] as const) {
    validateNonNegativeInteger(
      counts[key],
      `Invalid profile counts response: ${key} must be a non-negative integer`,
    )
  }
  return value as ProfileCounts
}

function validateProfileViewer(value: unknown): ProfileViewer {
  const viewer = objectRecord(value, "profile viewer")
  for (const key of [
    "isSelf",
    "isFollowing",
    "isBlocked",
    "isBlockedBy",
  ] as const) {
    validateBoolean(
      viewer[key],
      `Invalid profile viewer response: ${key} must be boolean`,
    )
  }
  return value as ProfileViewer
}

export function validateUserProfile(value: unknown): UserProfile {
  const profile = objectRecord(value, "user profile")
  validatePublicUser(profile.user)
  validateProfileCounts(profile.counts)
  return value as UserProfile
}

export function validateUserProfileViewer(value: unknown): UserProfileViewer {
  const response = objectRecord(value, "profile viewer")
  if (response.viewer !== null) validateProfileViewer(response.viewer)
  if (response.counts !== null) validateProfileCounts(response.counts)
  return value as UserProfileViewer
}

function validateProfileGameRow(value: unknown): ProfileGameRow {
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
  return value as ProfileGameRow
}

export function validateProfileGameRows(value: unknown): ProfileGameRow[] {
  return validateArray(value, "Invalid profile games response").map(
    validateProfileGameRow,
  )
}

export function validateUserStorageUsage(value: unknown): UserStorageUsage {
  const usage = objectRecord(value, "storage usage")
  validateNonNegativeInteger(
    usage.usedBytes,
    "Invalid storage usage response: usedBytes must be a non-negative integer",
  )
  validateNullablePositiveInteger(
    usage.quotaBytes,
    "Invalid storage usage response: quotaBytes must be a positive integer or null",
  )
  return value as UserStorageUsage
}
