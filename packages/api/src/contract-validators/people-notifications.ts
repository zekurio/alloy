import {
  NOTIFICATION_TYPES,
  type NotificationEvent,
  type NotificationRow,
  type NotificationsResponse,
  type UserListRow,
  type UserSummary,
} from "alloy-contracts"

import {
  objectRecord,
  validateArray,
  validateBatchProgress,
  validateBoolean,
  validateEnumString,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNullableDateString,
  validateNullableString,
  validateRequiredString,
  validateString,
} from "../runtime-validation"
import { validateBooleanFlag } from "./queue"
const NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(NOTIFICATION_TYPES)
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
  validateNullableString(
    row.image,
    `Invalid ${label} response: image must be string or null`,
  )
  return value as UserSummary
}

export function validateUserSummaries(value: unknown): UserSummary[] {
  return validateArray(value, "Invalid users response").map((item) =>
    validateUserSummary(item),
  )
}

export function validateUserListRow(value: unknown): UserListRow {
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
  validateNullableString(
    clip.thumbBlurHash,
    "Invalid notification clip response: thumbBlurHash must be string or null",
  )
  validateIsoDateString(
    clip.updatedAt,
    "Invalid notification clip response: updatedAt must be a date string",
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
