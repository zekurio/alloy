import {
  objectRecord,
  validateArray,
  validateEnumString,
  validateIsoDateString,
  validateNullableDateString,
  validateNullableRequiredString,
  validateNullableString,
  validateRequiredString,
} from "@alloy/api/runtime-validation"
import {
  NOTIFICATION_KINDS,
  type NotificationItem,
  type NotificationListResponse,
  type NotificationStreamEvent,
} from "@alloy/contracts"

import { validateUserSummary } from "./people"

const NOTIFICATION_KIND_SET: ReadonlySet<string> = new Set(NOTIFICATION_KINDS)

export function validateNotificationItem(value: unknown): NotificationItem {
  const row = objectRecord(value, "notification")
  validateRequiredString(
    row.id,
    "Invalid notification response: id is required",
  )
  validateEnumString(
    row.kind,
    NOTIFICATION_KIND_SET,
    "Invalid notification response: kind is invalid",
  )
  validateUserSummary(row.actor, "notification actor")
  validateNotificationClip(row.clip)
  validateNullableString(
    row.commentId,
    "Invalid notification response: commentId must be nullable string",
  )
  validateNullableString(
    row.commentSnippet,
    "Invalid notification response: commentSnippet must be nullable string",
  )
  validateNullableDateString(
    row.readAt,
    "Invalid notification response: readAt must be nullable date string",
  )
  validateIsoDateString(
    row.createdAt,
    "Invalid notification response: createdAt must be a date string",
  )
  return value as NotificationItem
}

export function validateNotificationList(
  value: unknown,
): NotificationListResponse {
  const row = objectRecord(value, "notifications")
  const items = validateArray(
    row.items,
    "Invalid notifications response: items must be an array",
  ).map(validateNotificationItem)
  validateNullableString(
    row.nextCursor,
    "Invalid notifications response: nextCursor must be nullable string",
  )
  return { items, nextCursor: row.nextCursor }
}

export function validateNotificationStreamEvent(
  value: unknown,
): NotificationStreamEvent {
  const row = objectRecord(value, "notification event")
  if (row.type !== "notification") {
    throw new Error("Invalid notification event response: type is invalid")
  }
  return { type: "notification", item: validateNotificationItem(row.item) }
}

function validateNotificationClip(value: unknown): void {
  if (value === null) return
  const row = objectRecord(value, "notification clip")
  validateRequiredString(
    row.id,
    "Invalid notification clip response: id is required",
  )
  validateRequiredString(
    row.title,
    "Invalid notification clip response: title is required",
  )
  validateNullableRequiredString(
    row.thumbVersion,
    "Invalid notification clip response: thumbVersion must be nullable string",
  )
}
