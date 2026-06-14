import {
  objectRecord,
  validateArray,
  validateEnumString,
  validateIntegerInRange,
  validateIsoDateString,
  validateNullableNonNegativeInteger,
  validateNullablePositiveInteger,
  validateNullableRequiredString,
  validateNullableString,
  validateRequiredString,
} from "@alloy/api/runtime-validation"
import {
  CLIP_STATUS,
  type InitiateStagingResponse,
  type PublishStagingResponse,
  RECORDING_KIND,
  type StagingRecordingPage,
  type StagingRecordingRow,
} from "@alloy/contracts"

import { validateUploadTicket } from "./queue"
import { validateGameRowFields } from "./shared"

const CLIP_STATUS_SET: ReadonlySet<string> = new Set(CLIP_STATUS)
const RECORDING_KIND_SET: ReadonlySet<string> = new Set(RECORDING_KIND)

function assertNoStorageKey(value: Record<string, unknown>) {
  if ("sourceKey" in value || "storageKey" in value) {
    throw new Error("Invalid staging response: storage key must not be public")
  }
}

export function validateStagingRow(value: unknown): StagingRecordingRow {
  const row = objectRecord(value, "staging recording")
  assertNoStorageKey(row)

  for (const key of ["id", "authorId", "title"] as const) {
    validateRequiredString(
      row[key],
      `Invalid staging response: ${key} is required`,
    )
  }
  validateEnumString(
    row.kind,
    RECORDING_KIND_SET,
    "Invalid staging response: kind is invalid",
  )
  validateEnumString(
    row.status,
    CLIP_STATUS_SET,
    "Invalid staging response: status is invalid",
  )
  validateNullablePositiveInteger(
    row.steamgriddbId,
    "Invalid staging response: steamgriddbId must be a positive integer or null",
  )
  for (const key of [
    "description",
    "game",
    "sourceContentType",
    "sourceVideoCodec",
    "sourceAudioCodec",
    "failureReason",
    "originDeviceName",
    "thumbKey",
    "thumbBlurHash",
  ] as const) {
    validateNullableString(
      row[key],
      `Invalid staging response: ${key} must be string or null`,
    )
  }
  for (const key of ["sourceSizeBytes", "durationMs"] as const) {
    validateNullableNonNegativeInteger(
      row[key],
      `Invalid staging response: ${key} must be a non-negative integer or null`,
    )
  }
  for (const key of ["width", "height"] as const) {
    validateNullablePositiveInteger(
      row[key],
      `Invalid staging response: ${key} must be a positive integer or null`,
    )
  }
  validateIntegerInRange(
    row.encodeProgress,
    0,
    100,
    "Invalid staging response: encodeProgress must be an integer between 0 and 100",
  )
  validateIsoDateString(
    row.createdAt,
    "Invalid staging response: createdAt must be a date string",
  )
  validateIsoDateString(
    row.updatedAt,
    "Invalid staging response: updatedAt must be a date string",
  )
  if (row.gameRef !== null) {
    validateGameRowFields(
      objectRecord(row.gameRef, "staging game"),
      "staging game",
    )
  }
  validateArray(
    row.tags,
    "Invalid staging response: tags must be an array",
  ).map((tag) =>
    validateRequiredString(
      tag,
      "Invalid staging response: tag must be a string",
    ),
  )
  return value as StagingRecordingRow
}

export function validateStagingRows(value: unknown): StagingRecordingRow[] {
  return validateArray(value, "Invalid staging response").map(
    validateStagingRow,
  )
}

export function validateStagingPage(value: unknown): StagingRecordingPage {
  const page = objectRecord(value, "staging recordings")
  validateArray(
    page.items,
    "Invalid staging response: items must be an array",
  ).map(validateStagingRow)
  validateNullableRequiredString(
    page.nextCursor,
    "Invalid staging response: nextCursor must be a non-empty string or null",
  )
  return value as StagingRecordingPage
}

export function validateInitiateStagingResponse(
  value: unknown,
): InitiateStagingResponse {
  const response = objectRecord(value, "initiate staging")
  validateRequiredString(
    response.stagingId,
    "Invalid initiate staging response: stagingId is required",
  )
  validateUploadTicket(response.ticket)
  validateUploadTicket(response.thumbTicket)
  return value as InitiateStagingResponse
}

export function validatePublishStagingResponse(
  value: unknown,
): PublishStagingResponse {
  const response = objectRecord(value, "publish staging")
  validateRequiredString(
    response.clipId,
    "Invalid publish staging response: clipId is required",
  )
  return value as PublishStagingResponse
}
