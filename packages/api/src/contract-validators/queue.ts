import {
  CLIP_STATUS,
  type ClipLikeState,
  type InitiateClipResponse,
  type QueueClip,
  type QueueEvent,
  type UploadTicket,
} from "alloy-contracts"

import {
  objectRecord,
  validateArray,
  validateBoolean,
  validateEnumString,
  validateIntegerInRange,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNullableString,
  validateRequiredString,
  validateStringRecord,
  validateUrlString,
} from "../runtime-validation"
import { validateLikeState } from "./shared"
const CLIP_STATUS_SET: ReadonlySet<string> = new Set(CLIP_STATUS)
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
  validateIsoDateString(
    row.updatedAt,
    "Invalid queue response: updatedAt must be a date string",
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
