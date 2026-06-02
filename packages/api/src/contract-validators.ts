import {
  type AdminEncoderCapabilities,
  type AdminRuntimeConfig,
  type AdminUsersResponse,
  type AdminUserStorageRow,
  CLIP_PRIVACY,
  CLIP_STATUS,
  type ClipLikeState,
  type ClipPage,
  type ClipRow,
  type CommentPage,
  type CommentRow,
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  type FeedChipGame,
  type FeedChipsResponse,
  type FeedPage,
  type GameDetail,
  type GameListRow,
  type GameRow,
  type InitiateClipResponse,
  type LoginSplashClip,
  type MlGameSuggestionResponse,
  NOTIFICATION_TYPES,
  type NotificationEvent,
  type NotificationRow,
  type NotificationsResponse,
  type ProfileCounts,
  type ProfileGameRow,
  type ProfileViewer,
  type PublicAuthConfig,
  type PublicAuthProvider,
  type PublicLoginSplashConfig,
  type PublicMlConfig,
  type PublicUser,
  type QueueClip,
  type QueueEvent,
  RUNTIME_CONFIG_VERSION,
  type RuntimeConfig,
  type SearchResults,
  type SteamGridDBSearchResult,
  type SteamGridDBStatus,
  STORAGE_DRIVERS,
  type UploadTicket,
  USER_ROLES,
  type UserListRow,
  type UserProfile,
  type UserProfileViewer,
  type UserStorageUsage,
  type UserSummary,
} from "@workspace/contracts"
import {
  objectRecord,
  validateArray,
  validateBatchProgress,
  validateBoolean,
  validateEnumString,
  validateEvenIntegerInRange,
  validateIntegerInRange,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNonNegativeNumber,
  validateNullableDateString,
  validateNullableEnumString,
  validateNullableNonNegativeInteger,
  validateNullablePositiveInteger,
  validateNullableRequiredString,
  validateNullableString,
  validateNullableUrlString,
  validateOptionalString,
  validateOptionalUrlString,
  validatePositiveInteger,
  validateRequiredString,
  validateString,
  validateStringArray,
  validateStringRecord,
  validateUrlString,
} from "./runtime-validation"

const CLIP_PRIVACY_SET: ReadonlySet<string> = new Set(CLIP_PRIVACY)
const CLIP_STATUS_SET: ReadonlySet<string> = new Set(CLIP_STATUS)
const ENCODER_CODEC_SET: ReadonlySet<string> = new Set(ENCODER_CODECS)
const ENCODER_HWACCEL_SET: ReadonlySet<string> = new Set(ENCODER_HWACCELS)
const NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(NOTIFICATION_TYPES)
const STORAGE_DRIVER_SET: ReadonlySet<string> = new Set(STORAGE_DRIVERS)
const USER_ROLE_SET: ReadonlySet<string> = new Set(USER_ROLES)
const PUBLIC_AUTH_BOOLEAN_FIELDS = [
  "openRegistrations",
  "passkeyEnabled",
  "requireAuthToBrowse",
] as const
const RUNTIME_CONFIG_BOOLEAN_FIELDS = [
  "openRegistrations",
  "setupComplete",
  "passkeyEnabled",
  "requireAuthToBrowse",
] as const

function assertNoStorageKey(value: Record<string, unknown>, label: string) {
  if ("storageKey" in value) {
    throw new Error(`Invalid ${label} response: storageKey must not be public`)
  }
}

function validateClipGameRef(value: unknown) {
  const row = objectRecord(value, "clip game")
  validateGameRowFields(row, "clip game")
}

function validateClipEncodedVariant(value: unknown) {
  const variant = objectRecord(value, "clip variant")
  assertNoStorageKey(variant, "clip variant")
  for (const key of ["id", "label", "contentType"] as const) {
    validateRequiredString(
      variant[key],
      `Invalid clip variant response: ${key} is required`,
    )
  }
  for (const key of ["width", "height"] as const) {
    validatePositiveInteger(
      variant[key],
      `Invalid clip variant response: ${key} must be a positive integer`,
    )
  }
  validateNonNegativeInteger(
    variant.sizeBytes,
    "Invalid clip variant response: sizeBytes must be a non-negative integer",
  )
  validateBoolean(
    variant.isDefault,
    "Invalid clip variant response: isDefault must be boolean",
  )
  if (variant.settings !== undefined) {
    validateClipVariantSettings(variant.settings)
  }
  if (variant.remuxSettings !== undefined) {
    validateClipRemuxSettings(variant.remuxSettings)
  }
}

function validateClipVariantSettings(value: unknown) {
  const settings = objectRecord(value, "clip variant settings")
  for (
    const key of [
      "hwaccel",
      "codec",
      "extraInputArgs",
      "extraOutputArgs",
    ] as const
  ) {
    validateString(
      settings[key],
      `Invalid clip variant settings response: ${key} must be a string`,
    )
  }
  if (settings.audioCodec !== "aac" && settings.audioCodec !== "none") {
    throw new Error(
      "Invalid clip variant settings response: audioCodec invalid",
    )
  }
  for (const key of ["quality", "audioBitrateKbps"] as const) {
    validateNonNegativeInteger(
      settings[key],
      `Invalid clip variant settings response: ${key} must be a non-negative integer`,
    )
  }
  validatePositiveInteger(
    settings.height,
    "Invalid clip variant settings response: height must be a positive integer",
  )
  validateNullableNonNegativeInteger(
    settings.trimStartMs,
    "Invalid clip variant settings response: trimStartMs must be a non-negative integer or null",
  )
  validateNullableNonNegativeInteger(
    settings.trimEndMs,
    "Invalid clip variant settings response: trimEndMs must be a non-negative integer or null",
  )
  if (settings.preset !== undefined) {
    validateString(
      settings.preset,
      "Invalid clip variant settings response: preset must be a string",
    )
  }
}

function validateClipRemuxSettings(value: unknown) {
  const settings = objectRecord(value, "clip remux settings")
  validateNullableNonNegativeInteger(
    settings.trimStartMs,
    "Invalid clip remux settings response: trimStartMs must be a non-negative integer or null",
  )
  validateNullableNonNegativeInteger(
    settings.trimEndMs,
    "Invalid clip remux settings response: trimEndMs must be a non-negative integer or null",
  )
}

export function validateClipRow(value: unknown): ClipRow {
  const row = objectRecord(value, "clip")
  assertNoStorageKey(row, "clip")
  validateClipIdentityFields(row)
  validateClipMetadataFields(row)
  validateClipCounters(row)
  validateClipTimestamps(row)
  validateClipRelationships(row)
  return value as ClipRow
}

function validateClipIdentityFields(row: Record<string, unknown>) {
  for (
    const key of [
      "id",
      "authorId",
      "title",
      "gameId",
      "authorUsername",
      "authorName",
    ] as const
  ) {
    validateRequiredString(
      row[key],
      `Invalid clip response: ${key} is required`,
    )
  }
}

function validateClipMetadataFields(row: Record<string, unknown>) {
  for (
    const key of [
      "description",
      "game",
      "sourceContentType",
      "openGraphContentType",
      "failureReason",
      "authorImage",
    ] as const
  ) {
    validateNullableString(
      row[key],
      `Invalid clip response: ${key} must be string or null`,
    )
  }
  validateEnumString(
    row.privacy,
    CLIP_PRIVACY_SET,
    "Invalid clip response: privacy is invalid",
  )
  validateEnumString(
    row.status,
    CLIP_STATUS_SET,
    "Invalid clip response: status is invalid",
  )
}

function validateClipCounters(row: Record<string, unknown>) {
  for (
    const key of [
      "sourceSizeBytes",
      "openGraphSizeBytes",
      "durationMs",
      "trimStartMs",
      "trimEndMs",
    ] as const
  ) {
    validateNullableNonNegativeInteger(
      row[key],
      `Invalid clip response: ${key} must be a non-negative integer or null`,
    )
  }
  for (const key of ["width", "height"] as const) {
    validateNullablePositiveInteger(
      row[key],
      `Invalid clip response: ${key} must be a positive integer or null`,
    )
  }
  for (const key of ["viewCount", "likeCount", "commentCount"] as const) {
    validateNonNegativeInteger(
      row[key],
      `Invalid clip response: ${key} must be a non-negative integer`,
    )
  }
  validateIntegerInRange(
    row.encodeProgress,
    0,
    100,
    "Invalid clip response: encodeProgress must be an integer between 0 and 100",
  )
}

function validateClipTimestamps(row: Record<string, unknown>) {
  validateIsoDateString(
    row.createdAt,
    "Invalid clip response: createdAt must be a date string",
  )
  validateIsoDateString(
    row.updatedAt,
    "Invalid clip response: updatedAt must be a date string",
  )
  validateNullableString(
    row.thumbKey,
    "Invalid clip response: thumbKey must be string or null",
  )
}

function validateClipRelationships(row: Record<string, unknown>) {
  if (row.gameRef !== null) {
    validateClipGameRef(row.gameRef)
  }
  if (row.mentions !== undefined) {
    validateArray(
      row.mentions,
      "Invalid clip response: mentions must be an array",
    ).map((mention) => validateUserSummary(mention, "clip mention"))
  }
  validateArray(
    row.variants,
    "Invalid clip response: variants must be an array",
  ).map(validateClipEncodedVariant)
}

export function validateClipRows(value: unknown): ClipRow[] {
  return validateArray(value, "Invalid clips response").map(validateClipRow)
}

export function validateClipPage(value: unknown): ClipPage {
  const page = objectRecord(value, "clips")
  validateArray(
    page.items,
    "Invalid clips response: items must be an array",
  ).map(validateClipRow)
  validateNullableRequiredString(
    page.nextCursor,
    "Invalid clips response: nextCursor must be a non-empty string or null",
  )
  return value as ClipPage
}

function validateQueueClip(value: unknown): QueueClip {
  const row = objectRecord(value, "queue clip")
  validateRequiredString(row.id, "Invalid queue response: id is required")
  validateRequiredString(row.title, "Invalid queue response: title is required")
  validateRequiredString(
    row.gameSlug,
    "Invalid queue response: gameSlug is required",
  )
  validateEnumString(
    row.status,
    CLIP_STATUS_SET,
    "Invalid queue response: status is invalid",
  )
  validateIntegerInRange(
    row.encodeProgress,
    0,
    100,
    "Invalid queue response: encodeProgress must be an integer between 0 and 100",
  )
  validateNullableString(
    row.failureReason,
    "Invalid queue response: failureReason must be string or null",
  )
  validateIsoDateString(
    row.createdAt,
    "Invalid queue response: createdAt must be a date string",
  )
  validateBoolean(
    row.hasThumb,
    "Invalid queue response: hasThumb must be boolean",
  )
  return value as QueueClip
}

export function validateQueueClips(value: unknown): QueueClip[] {
  return validateArray(value, "Invalid queue response").map(validateQueueClip)
}

export function validateQueueEvent(value: unknown): QueueEvent {
  const event = objectRecord(value, "queue event")
  switch (event.type) {
    case "upsert":
      validateQueueClip(event.clip)
      return value as QueueEvent
    case "progress":
      validateRequiredString(
        event.id,
        "Invalid queue event response: id is required",
      )
      validateIntegerInRange(
        event.encodeProgress,
        0,
        100,
        "Invalid queue event response: encodeProgress must be an integer between 0 and 100",
      )
      return value as QueueEvent
    case "remove":
      validateRequiredString(
        event.id,
        "Invalid queue event response: id is required",
      )
      return value as QueueEvent
    default:
      throw new Error("Invalid queue event response: type is invalid")
  }
}

export function validateInitiateClipResponse(
  value: unknown,
): InitiateClipResponse {
  const response = objectRecord(value, "initiate clip")
  validateRequiredString(
    response.clipId,
    "Invalid initiate clip response: clipId is required",
  )
  validateUploadTicket(response.ticket)
  return value as InitiateClipResponse
}

function validateUploadTicket(value: unknown): UploadTicket {
  const ticket = objectRecord(value, "upload ticket")
  validateUrlString(
    ticket.uploadUrl,
    "Invalid upload ticket response: uploadUrl must be a URL",
  )
  if (ticket.method !== "PUT" && ticket.method !== "POST") {
    throw new Error("Invalid upload ticket response: method is invalid")
  }
  validateStringRecord(
    ticket.headers,
    "upload ticket headers",
    "Invalid upload ticket response: headers must be string values",
  )
  validateNonNegativeInteger(
    ticket.expiresAt,
    "Invalid upload ticket response: expiresAt must be a non-negative integer",
  )
  return value as UploadTicket
}

export function validateClipLikeState(value: unknown): ClipLikeState {
  validateLikeState(value, "clip")
  return value as ClipLikeState
}

function validateLikeState(value: unknown, label: "clip" | "comment"): void {
  const response = objectRecord(value, `${label} like`)
  validateBoolean(
    response.liked,
    `Invalid ${label} like response: liked must be boolean`,
  )
  validateNonNegativeInteger(
    response.likeCount,
    `Invalid ${label} like response: likeCount must be a non-negative integer`,
  )
}

export function validateBooleanFlag<T extends string>(
  value: unknown,
  key: T,
): Record<T, boolean>
export function validateBooleanFlag<T extends string, V extends boolean>(
  value: unknown,
  key: T,
  expected: V,
): Record<T, V>
export function validateBooleanFlag<T extends string>(
  value: unknown,
  key: T,
  expected?: boolean,
): Record<T, boolean> {
  const response = objectRecord(value, key)
  if (
    (expected === undefined &&
      response[key] !== true &&
      response[key] !== false) ||
    (expected !== undefined && response[key] !== expected)
  ) {
    throw new Error(`Invalid ${key} response: ${key} must be boolean`)
  }
  return response as Record<T, boolean>
}

export function booleanFlagResponseValidator<T extends string>(
  key: T,
): (value: unknown) => Record<T, boolean>
export function booleanFlagResponseValidator<
  T extends string,
  V extends boolean,
>(key: T, expected: V): (value: unknown) => Record<T, V>
export function booleanFlagResponseValidator<T extends string>(
  key: T,
  expected?: boolean,
): (value: unknown) => Record<T, boolean> {
  return (value: unknown) =>
    expected === undefined
      ? validateBooleanFlag(value, key)
      : validateBooleanFlag(value, key, expected)
}

export function validateFeedPage(value: unknown): FeedPage {
  const page = objectRecord(value, "feed")
  validateArray(
    page.items,
    "Invalid feed response: items must be an array",
  ).map(validateClipRow)
  validateNullableRequiredString(
    page.nextCursor,
    "Invalid feed response: nextCursor must be a non-empty string or null",
  )
  return value as FeedPage
}

function validateFeedChipGame(value: unknown): FeedChipGame {
  const row = objectRecord(value, "feed chip game")
  for (const key of ["id", "slug", "name"] as const) {
    validateRequiredString(
      row[key],
      `Invalid feed chips response: ${key} is required`,
    )
  }
  for (const key of ["iconUrl", "logoUrl"] as const) {
    validateNullableUrlString(
      row[key],
      `Invalid feed chips response: ${key} must be a URL or null`,
    )
  }
  validateNonNegativeNumber(
    row.interaction,
    "Invalid feed chips response: interaction must be numeric",
  )
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid feed chips response: clipCount must be a non-negative integer",
  )
  return value as FeedChipGame
}

export function validateFeedChipsResponse(value: unknown): FeedChipsResponse {
  const response = objectRecord(value, "feed chips")
  validateArray(
    response.games,
    "Invalid feed chips response: games must be an array",
  ).map(validateFeedChipGame)
  return value as FeedChipsResponse
}

export function validateSearchResults(value: unknown): SearchResults {
  const results = objectRecord(value, "search")
  validateArray(
    results.clips,
    "Invalid search response: clips must be an array",
  ).map(validateClipRow)
  validateArray(
    results.games,
    "Invalid search response: games must be an array",
  ).map(validateGameListRow)
  validateArray(
    results.users,
    "Invalid search response: users must be an array",
  ).map(validateUserListRow)
  return value as SearchResults
}

export function validateNotificationsResponse(
  value: unknown,
): NotificationsResponse {
  const response = objectRecord(value, "notifications")
  validateArray(
    response.items,
    "Invalid notifications response: items must be an array",
  ).map(validateNotificationRow)
  validateUnreadCount(response, "notifications")
  return value as NotificationsResponse
}

export function validateUserSummary(
  value: unknown,
  label = "user",
): UserSummary {
  const row = objectRecord(value, label)
  for (const key of ["id", "username"] as const) {
    validateRequiredString(
      row[key],
      `Invalid ${label} response: ${key} is required`,
    )
  }
  validateString(
    row.displayUsername,
    `Invalid ${label} response: displayUsername is required`,
  )
  validateString(row.name, `Invalid ${label} response: name is required`)
  validateNullableString(
    row.image,
    `Invalid ${label} response: image must be string or null`,
  )
  return value as UserSummary
}

export function validateUserSummaries(value: unknown): UserSummary[] {
  return validateArray(value, "Invalid users response").map((item) =>
    validateUserSummary(item)
  )
}

function validateUserListRow(value: unknown): UserListRow {
  const row = objectRecord(value, "user list")
  validateUserSummary(row, "user list")
  validateIsoDateString(
    row.createdAt,
    "Invalid user list response: createdAt must be a date string",
  )
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid user list response: clipCount must be a non-negative integer",
  )
  return value as UserListRow
}

function validateNotificationClipRef(value: unknown) {
  const clip = objectRecord(value, "notification clip")
  for (const key of ["id", "title", "gameSlug"] as const) {
    validateRequiredString(
      clip[key],
      `Invalid notification clip response: ${key} is required`,
    )
  }
  validateBoolean(
    clip.hasThumb,
    "Invalid notification clip response: hasThumb must be boolean",
  )
}

function validateNotificationCommentRef(value: unknown) {
  const comment = objectRecord(value, "notification comment")
  validateRequiredString(
    comment.id,
    "Invalid notification comment response: id is required",
  )
  validateString(
    comment.body,
    "Invalid notification comment response: body is required",
  )
}

export function validateNotificationRow(value: unknown): NotificationRow {
  const row = objectRecord(value, "notification")
  validateRequiredString(
    row.id,
    "Invalid notification response: id is required",
  )
  validateEnumString(
    row.type,
    NOTIFICATION_TYPE_SET,
    "Invalid notification response: type is invalid",
  )
  if (row.actor !== null) validateUserSummary(row.actor, "notification actor")
  if (row.clip !== null) validateNotificationClipRef(row.clip)
  if (row.comment !== null) validateNotificationCommentRef(row.comment)
  validateNullableDateString(
    row.readAt,
    "Invalid notification response: readAt must be a date string or null",
  )
  validateIsoDateString(
    row.createdAt,
    "Invalid notification response: createdAt must be a date string",
  )
  return value as NotificationRow
}

export function validateNotificationsReadAllResponse(value: unknown): {
  readAt: string
  unreadCount: number
} {
  const response = objectRecord(value, "mark all notifications read")
  validateIsoDateString(
    response.readAt,
    "Invalid mark all notifications read response: readAt must be a date string",
  )
  validateUnreadCount(response, "mark all notifications read")
  return value as { readAt: string; unreadCount: number }
}

export function validateNotificationsDeleteResponse(value: unknown): {
  deleted: true
  unreadCount: number
} {
  const response = validateBooleanFlag(value, "deleted", true) as Record<
    string,
    unknown
  >
  validateUnreadCount(response, "delete notifications")
  return value as { deleted: true; unreadCount: number }
}

function validateUnreadCount(
  value: Record<string, unknown>,
  label: string,
): void {
  validateNonNegativeInteger(
    value.unreadCount,
    `Invalid ${label} response: unreadCount must be a non-negative integer`,
  )
}

export function validateNotificationEvent(value: unknown): NotificationEvent {
  const event = objectRecord(value, "notification event")
  switch (event.type) {
    case "snapshot":
      validateNotificationsResponse(event.payload)
      return value as NotificationEvent
    case "upsert":
      validateNotificationRow(event.notification)
      validateUnreadCount(event, "notification event")
      return value as NotificationEvent
    case "read":
      validateRequiredString(
        event.id,
        "Invalid notification event response: id is required",
      )
      validateIsoDateString(
        event.readAt,
        "Invalid notification event response: readAt must be a date string",
      )
      validateUnreadCount(event, "notification event")
      return value as NotificationEvent
    case "read_all":
      validateIsoDateString(
        event.readAt,
        "Invalid notification event response: readAt must be a date string",
      )
      validateUnreadCount(event, "notification event")
      return value as NotificationEvent
    case "remove":
      validateRequiredString(
        event.id,
        "Invalid notification event response: id is required",
      )
      validateUnreadCount(event, "notification event")
      return value as NotificationEvent
    case "clear":
      validateUnreadCount(event, "notification event")
      return value as NotificationEvent
    default:
      throw new Error("Invalid notification event response: type is invalid")
  }
}

export function validateAccountStateResponse(value: unknown): {
  disabledAt: string | null
} {
  validateAccountDisabledAt(value, "account state", "nullable")
  return value as { disabledAt: string | null }
}

export function validateDisableAccountResponse(value: unknown): {
  disabledAt: string
} {
  validateAccountDisabledAt(value, "disable account", "date")
  return value as { disabledAt: string }
}

export function validateReactivateAccountResponse(value: unknown): {
  disabledAt: null
} {
  validateAccountDisabledAt(value, "reactivate account", "null")
  return value as { disabledAt: null }
}

function validateAccountDisabledAt(
  value: unknown,
  label: string,
  mode: "nullable" | "date" | "null",
): void {
  const response = objectRecord(value, label)
  if (mode === "nullable") {
    validateNullableDateString(
      response.disabledAt,
      `Invalid ${label} response: disabledAt must be a date string or null`,
    )
    return
  }
  if (mode === "date") {
    validateIsoDateString(
      response.disabledAt,
      `Invalid ${label} response: disabledAt must be a date string`,
    )
    return
  }
  if (response.disabledAt !== null) {
    throw new Error(`Invalid ${label} response: disabledAt must be null`)
  }
}

export function validateDeleteClipsResponse(value: unknown): {
  deleted: number
  hasMore: boolean
} {
  return validateBatchProgress(value, "delete clips", "deleted")
}

function validatePublicAuthProvider(value: unknown): PublicAuthProvider {
  const provider = objectRecord(value, "auth provider")
  for (const key of ["providerId", "displayName"] as const) {
    validateRequiredString(
      provider[key],
      `Invalid auth config response: provider.${key} is required`,
    )
  }
  for (const key of ["buttonColor", "buttonTextColor"] as const) {
    validateOptionalString(
      provider[key],
      `Invalid auth config response: provider.${key} must be a string`,
    )
  }
  validateOptionalUrlString(
    provider.iconUrl,
    "Invalid auth config response: provider.iconUrl must be a URL",
  )
  return value as PublicAuthProvider
}

function validateLoginSplashClip(value: unknown): LoginSplashClip {
  const clip = objectRecord(value, "login splash clip")
  for (const key of ["id", "title"] as const) {
    validateRequiredString(
      clip[key],
      `Invalid auth config response: loginSplash.${key} is required`,
    )
  }
  validateNullableString(
    clip.game,
    "Invalid auth config response: loginSplash.game must be string or null",
  )
  return value as LoginSplashClip
}

function validatePublicLoginSplashConfig(
  value: unknown,
): PublicLoginSplashConfig {
  const splash = objectRecord(value, "login splash")
  validateBoolean(
    splash.enabled,
    "Invalid auth config response: loginSplash.enabled must be boolean",
  )
  validateNullableDateString(
    splash.generatedAt,
    "Invalid auth config response: loginSplash.generatedAt must be a date string or null",
  )
  validateNullableString(
    splash.imageUrl,
    "Invalid auth config response: loginSplash.imageUrl must be string or null",
  )
  validateArray(
    splash.clips,
    "Invalid auth config response: loginSplash.clips must be an array",
  ).map(validateLoginSplashClip)
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
  for (
    const key of [
      "isSelf",
      "isFollowing",
      "isBlocked",
      "isBlockedBy",
    ] as const
  ) {
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

function validateGameRowFields(row: Record<string, unknown>, label: string) {
  for (const key of ["id", "name", "slug"] as const) {
    validateRequiredString(
      row[key],
      `Invalid ${label} response: ${key} is required`,
    )
  }
  validatePositiveInteger(
    row.steamgriddbId,
    `Invalid ${label} response: steamgriddbId must be a positive integer`,
  )
  validateNullableDateString(
    row.releaseDate,
    `Invalid ${label} response: releaseDate must be a date string or null`,
  )
  for (const key of ["heroUrl", "gridUrl", "logoUrl", "iconUrl"] as const) {
    validateNullableUrlString(
      row[key],
      `Invalid ${label} response: ${key} must be a URL or null`,
    )
  }
}

export function validateGameRow(value: unknown): GameRow {
  const row = objectRecord(value, "game")
  validateGameRowFields(row, "game")
  return value as GameRow
}

function validateGameListRow(value: unknown): GameListRow {
  const row = objectRecord(value, "game")
  validateGameRowFields(row, "game")
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid game response: clipCount must be a non-negative integer",
  )
  return value as GameListRow
}

export function validateGameListRows(value: unknown): GameListRow[] {
  return validateArray(value, "Invalid games response").map(validateGameListRow)
}

export function validateGameDetail(value: unknown): GameDetail {
  const row = objectRecord(value, "game detail")
  validateGameRowFields(row, "game detail")
  if (row.viewer !== null) {
    const viewer = objectRecord(row.viewer, "game detail viewer")
    validateBoolean(
      viewer.isFollowing,
      "Invalid game detail response: viewer.isFollowing must be boolean",
    )
  }
  validateNonNegativeInteger(
    row.favouritesCount,
    "Invalid game detail response: favouritesCount must be a non-negative integer",
  )
  return value as GameDetail
}

export function validateSteamGridDBStatus(value: unknown): SteamGridDBStatus {
  const status = objectRecord(value, "SteamGridDB status")
  validateBoolean(
    status.steamgriddbConfigured,
    "Invalid SteamGridDB status response: steamgriddbConfigured must be boolean",
  )
  return value as SteamGridDBStatus
}

function validateSteamGridDBSearchResult(
  value: unknown,
): SteamGridDBSearchResult {
  const row = objectRecord(value, "game search")
  validatePositiveInteger(
    row.id,
    "Invalid game search response: id must be a positive integer",
  )
  validateRequiredString(
    row.name,
    "Invalid game search response: name is required",
  )
  if (row.release_date !== undefined) {
    validatePositiveInteger(
      row.release_date,
      "Invalid game search response: release_date must be a positive integer",
    )
  }
  if (row.types !== undefined) {
    validateStringArray(
      row.types,
      "Invalid game search response: types must be an array of strings",
    )
  }
  if (row.verified !== undefined) {
    validateBoolean(
      row.verified,
      "Invalid game search response: verified must be boolean",
    )
  }
  if (row.iconUrl !== undefined) {
    validateNullableUrlString(
      row.iconUrl,
      "Invalid game search response: iconUrl must be a URL or null",
    )
  }
  return value as SteamGridDBSearchResult
}

export function validateSteamGridDBSearchResults(
  value: unknown,
): SteamGridDBSearchResult[] {
  return validateArray(value, "Invalid game search response").map(
    validateSteamGridDBSearchResult,
  )
}

export function validateAdminEncoderCapabilities(
  value: unknown,
): AdminEncoderCapabilities {
  const capabilities = objectRecord(value, "encoder capabilities")
  validateBoolean(
    capabilities.ffmpegOk,
    "Invalid encoder capabilities response: ffmpegOk must be boolean",
  )
  validateNullableString(
    capabilities.ffmpegVersion,
    "Invalid encoder capabilities response: ffmpegVersion must be string or null",
  )
  const available = objectRecord(
    capabilities.available,
    "encoder capabilities available",
  )
  for (const hwaccel of ENCODER_HWACCELS) {
    const hw = objectRecord(available[hwaccel], "encoder capabilities hwaccel")
    for (const codec of ["h264", "hevc", "av1"] as const) {
      validateBoolean(
        hw[codec],
        `Invalid encoder capabilities response: ${hwaccel}.${codec} must be boolean`,
      )
    }
  }
  return value as AdminEncoderCapabilities
}

export function validateAdminReEncodeResponse(value: unknown): {
  enqueued: number
  hasMore: boolean
} {
  return validateBatchProgress(value, "re-encode", "enqueued")
}

export function validatePublicMlConfig(value: unknown): PublicMlConfig {
  const config = objectRecord(value, "machine learning config")
  validateBoolean(
    config.enabled,
    "Invalid machine learning config: enabled must be boolean",
  )
  const gameSuggestion = objectRecord(
    config.gameSuggestion,
    "machine learning game suggestion config",
  )
  for (
    const key of [
      "frameCount",
      "frameMaxWidth",
      "maxFrames",
      "maxFrameBytes",
    ] as const
  ) {
    validatePositiveInteger(
      gameSuggestion[key],
      `Invalid machine learning config: gameSuggestion.${key} must be a positive integer`,
    )
  }
  return value as PublicMlConfig
}

export function validateMlGameSuggestionResponse(
  value: unknown,
): MlGameSuggestionResponse {
  const response = objectRecord(value, "machine learning game suggestions")
  if (response.kind !== "game-suggestion" || response.advisory !== true) {
    throw new Error("Invalid machine learning response: unexpected kind")
  }
  validateRequiredString(
    response.modelName,
    "Invalid machine learning response: modelName is required",
  )
  validateNullableRequiredString(
    response.modelVersion,
    "Invalid machine learning response: invalid modelVersion",
  )
  const predictions = validateArray(
    response.predictions,
    "Invalid machine learning response: predictions must be an array",
  )
  for (const [index, item] of predictions.entries()) {
    const prediction = objectRecord(item, "machine learning prediction")
    validatePositiveInteger(
      prediction.rank,
      "Invalid machine learning response: rank must be a positive integer",
    )
    if (prediction.rank !== index + 1) {
      throw new Error("Invalid machine learning response: rank is out of order")
    }
    validateRequiredString(
      prediction.label,
      "Invalid machine learning response: label is required",
    )
    if (
      typeof prediction.score !== "number" ||
      !Number.isFinite(prediction.score) ||
      prediction.score < 0 ||
      prediction.score > 1
    ) {
      throw new Error(
        "Invalid machine learning response: score must be between 0 and 1",
      )
    }
  }
  return value as MlGameSuggestionResponse
}

function validateRuntimeOAuthProvider(value: unknown, label: string) {
  const provider = objectRecord(value, label)
  for (const key of ["providerId", "displayName", "clientId"] as const) {
    validateRequiredString(
      provider[key],
      `Invalid ${label} config: ${key} is required`,
    )
  }
  validateString(
    provider.clientSecret,
    `Invalid ${label} config: clientSecret must be a string`,
  )
  if (provider.scopes !== undefined) {
    validateStringArray(
      provider.scopes,
      `Invalid ${label} config: scopes must be an array of strings`,
    )
  }
  validateBoolean(
    provider.enabled,
    `Invalid ${label} config: enabled must be boolean`,
  )
  for (const key of ["buttonColor", "buttonTextColor"] as const) {
    validateOptionalString(
      provider[key],
      `Invalid ${label} config: ${key} must be a string`,
    )
  }
  validateOptionalUrlString(
    provider.iconUrl,
    `Invalid ${label} config: iconUrl must be a URL`,
  )
  for (
    const key of [
      "discoveryUrl",
      "authorizationUrl",
      "tokenUrl",
      "userInfoUrl",
    ] as const
  ) {
    validateOptionalUrlString(
      provider[key],
      `Invalid ${label} config: ${key} must be a URL`,
    )
  }
  if (provider.pkce !== undefined) {
    validateBoolean(
      provider.pkce,
      `Invalid ${label} config: pkce must be boolean`,
    )
  }
  for (const key of ["usernameClaim", "quotaClaim", "roleClaim"] as const) {
    validateRequiredString(
      provider[key],
      `Invalid ${label} config: ${key} is required`,
    )
  }
}

function validateAdminEncoderVariant(value: unknown) {
  const variant = objectRecord(value, "admin encoder variant")
  for (const key of ["id", "name"] as const) {
    validateRequiredString(
      variant[key],
      `Invalid admin encoder variant config: ${key} is required`,
    )
  }
  validateEnumString(
    variant.codec,
    ENCODER_CODEC_SET,
    "Invalid admin encoder variant config: codec is invalid",
  )
  validateEvenIntegerInRange(
    variant.height,
    ENCODER_HEIGHT_MIN,
    ENCODER_HEIGHT_MAX,
    `Invalid admin encoder variant config: height must be an even integer between ${ENCODER_HEIGHT_MIN} and ${ENCODER_HEIGHT_MAX}`,
  )
  validateIntegerInRange(
    variant.quality,
    0,
    51,
    "Invalid admin encoder variant config: quality must be between 0 and 51",
  )
  validateIntegerInRange(
    variant.audioBitrateKbps,
    64,
    256,
    "Invalid admin encoder variant config: audioBitrateKbps must be between 64 and 256",
  )
  if (variant.preset !== undefined) {
    validateRequiredString(
      variant.preset,
      "Invalid admin encoder variant config: preset must be a non-empty string",
    )
  }
  for (const key of ["extraInputArgs", "extraOutputArgs"] as const) {
    validateString(
      variant[key],
      `Invalid admin encoder variant config: ${key} must be a string`,
    )
  }
}

function validateAdminEncoderConfig(value: unknown) {
  const encoder = objectRecord(value, "admin encoder config")
  validateBoolean(
    encoder.enabled,
    "Invalid admin encoder config: enabled must be boolean",
  )
  validateEnumString(
    encoder.hwaccel,
    ENCODER_HWACCEL_SET,
    "Invalid admin encoder config: hwaccel is invalid",
  )
  for (const key of ["qsvDevice", "vaapiDevice"] as const) {
    validateRequiredString(
      encoder[key],
      `Invalid admin encoder config: ${key} is required`,
    )
  }
  validateNullableRequiredString(
    encoder.defaultVariantId,
    "Invalid admin encoder config: defaultVariantId must be non-empty or null",
  )
  validateArray(
    encoder.variants,
    "Invalid admin encoder config: variants must be an array",
  ).map(validateAdminEncoderVariant)
}

function validateAdminLimitsConfig(value: unknown) {
  const limits = objectRecord(value, "admin limits config")
  validatePositiveInteger(
    limits.maxUploadBytes,
    "Invalid admin limits config: maxUploadBytes must be a positive integer",
  )
  validateNullablePositiveInteger(
    limits.defaultStorageQuotaBytes,
    "Invalid admin limits config: defaultStorageQuotaBytes must be a positive integer or null",
  )
  validatePositiveInteger(
    limits.uploadTtlSec,
    "Invalid admin limits config: uploadTtlSec must be a positive integer",
  )
  validatePositiveInteger(
    limits.queueConcurrency,
    "Invalid admin limits config: queueConcurrency must be a positive integer",
  )
}

function validateAdminIntegrationsConfig(value: unknown) {
  const integrations = objectRecord(value, "admin integrations config")
  validateString(
    integrations.steamgriddbApiKey,
    "Invalid admin integrations config: steamgriddbApiKey must be a string",
  )
}

function validateAdminGameClassifierConfig(value: unknown) {
  const gameClassifier = objectRecord(value, "admin game classifier config")
  for (const key of ["modelName", "repoId", "filename", "revision"] as const) {
    validateRequiredString(
      gameClassifier[key],
      `Invalid admin game classifier config: ${key} is required`,
    )
  }
  validateNullableRequiredString(
    gameClassifier.modelVersion,
    "Invalid admin game classifier config: modelVersion must be non-empty or null",
  )
  validateNullableRequiredString(
    gameClassifier.checkpointPath,
    "Invalid admin game classifier config: checkpointPath must be non-empty or null",
  )
}

function validateAdminMachineLearningConfig(value: unknown) {
  const machineLearning = objectRecord(value, "admin machine learning config")
  validateBoolean(
    machineLearning.enabled,
    "Invalid admin machine learning config: enabled must be boolean",
  )
  validateUrlString(
    machineLearning.baseUrl,
    "Invalid admin machine learning config: baseUrl must be a URL",
  )
  validatePositiveInteger(
    machineLearning.requestTimeoutMs,
    "Invalid admin machine learning config: requestTimeoutMs must be a positive integer",
  )
  validateAdminGameClassifierConfig(machineLearning.gameClassifier)
}

function validateAdminAppearanceConfig(value: unknown) {
  const appearance = objectRecord(value, "admin appearance config")
  const loginSplash = objectRecord(
    appearance.loginSplash,
    "admin login splash config",
  )
  validateBoolean(
    loginSplash.enabled,
    "Invalid admin login splash config: enabled must be boolean",
  )
  for (
    const clipId of validateArray(
      loginSplash.clipIds,
      "Invalid admin login splash config: clipIds must be an array",
    )
  ) {
    validateRequiredString(
      clipId,
      "Invalid admin login splash config: clipIds must contain strings",
    )
  }
  validateNullableDateString(
    loginSplash.generatedAt,
    "Invalid admin login splash config: generatedAt must be a date string or null",
  )
}

function validateAdminStorageConfig(value: unknown) {
  const storage = objectRecord(value, "admin storage config")
  validateEnumString(
    storage.driver,
    STORAGE_DRIVER_SET,
    "Invalid admin storage config: driver is invalid",
  )
  const fs = objectRecord(storage.fs, "admin filesystem storage config")
  validateRequiredString(
    fs.root,
    "Invalid admin filesystem storage config: root is required",
  )
  validateUrlString(
    fs.publicBaseUrl,
    "Invalid admin filesystem storage config: publicBaseUrl must be a URL",
  )
  validateString(
    fs.hmacSecret,
    "Invalid admin filesystem storage config: hmacSecret must be a string",
  )

  const s3 = objectRecord(storage.s3, "admin S3 storage config")
  for (const key of ["bucket", "region"] as const) {
    validateString(
      s3[key],
      `Invalid admin S3 storage config: ${key} must be a string`,
    )
  }
  validateOptionalUrlString(
    s3.endpoint,
    "Invalid admin S3 storage config: endpoint must be a URL",
  )
  validateOptionalString(
    s3.accessKeyId,
    "Invalid admin S3 storage config: accessKeyId must be a string",
  )
  validateOptionalString(
    s3.secretAccessKey,
    "Invalid admin S3 storage config: secretAccessKey must be a string",
  )
  validateBoolean(
    s3.forcePathStyle,
    "Invalid admin S3 storage config: forcePathStyle must be boolean",
  )
  validatePositiveInteger(
    s3.presignExpiresSec,
    "Invalid admin S3 storage config: presignExpiresSec must be a positive integer",
  )
  if (storage.driver === "s3") {
    validateRequiredString(
      s3.bucket,
      "Invalid admin S3 storage config: bucket is required when storage driver is s3",
    )
  }
}

function validateAdminSecretsConfig(value: unknown) {
  const secrets = objectRecord(value, "admin secrets config")
  validateString(
    secrets.viewerCookieSecret,
    "Invalid admin secrets config: viewerCookieSecret must be a string",
  )
}

function validateRuntimeConfigFields(
  config: Record<string, unknown>,
  label: string,
) {
  validatePositiveInteger(
    config.runtimeConfigVersion,
    `Invalid ${label} config: runtimeConfigVersion must be a positive integer`,
  )
  if (config.runtimeConfigVersion !== RUNTIME_CONFIG_VERSION) {
    throw new Error(
      `Invalid ${label} config: runtimeConfigVersion must be ${RUNTIME_CONFIG_VERSION}`,
    )
  }
  for (const key of RUNTIME_CONFIG_BOOLEAN_FIELDS) {
    validateBoolean(
      config[key],
      `Invalid ${label} config: ${key} must be boolean`,
    )
  }
  validateArray(
    config.oauthProviders,
    `Invalid ${label} config: oauthProviders must be an array`,
  ).map((provider) =>
    validateRuntimeOAuthProvider(provider, `${label} OAuth provider`)
  )
  validateAdminEncoderConfig(config.encoder)
  validateAdminLimitsConfig(config.limits)
  validateAdminIntegrationsConfig(config.integrations)
  validateAdminMachineLearningConfig(config.machineLearning)
  validateAdminAppearanceConfig(config.appearance)
  validateAdminStorageConfig(config.storage)
  validateAdminSecretsConfig(config.secrets)
}

export function validateRuntimeConfigExport(value: unknown): RuntimeConfig {
  const config = objectRecord(value, "runtime config export")
  validateRuntimeConfigFields(config, "runtime config export")
  return value as RuntimeConfig
}

export function validateAdminRuntimeConfig(value: unknown): AdminRuntimeConfig {
  const config = objectRecord(value, "admin runtime")
  validateRuntimeConfigFields(config, "admin runtime")
  validateUrlString(
    config.authBaseURL,
    "Invalid admin runtime config: authBaseURL must be a URL",
  )
  return value as AdminRuntimeConfig
}
