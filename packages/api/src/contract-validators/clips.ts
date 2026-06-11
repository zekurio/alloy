import {
  CLIP_PRIVACY,
  CLIP_STATUS,
  type ClipPage,
  type ClipRow,
} from "alloy-contracts"

import {
  objectRecord,
  validateArray,
  validateEnumString,
  validateIntegerInRange,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNullableNonNegativeInteger,
  validateNullablePositiveInteger,
  validateNullableRequiredString,
  validateNullableString,
  validatePositiveInteger,
  validateRequiredString,
} from "../runtime-validation"
import { validateUserSummary } from "./people-notifications"
import { validateGameRowFields } from "./shared"
const CLIP_PRIVACY_SET: ReadonlySet<string> = new Set(CLIP_PRIVACY)
const CLIP_STATUS_SET: ReadonlySet<string> = new Set(CLIP_STATUS)
function assertNoStorageKey(value: Record<string, unknown>, label: string) {
  if ("storageKey" in value) {
    throw new Error(`Invalid ${label} response: storageKey must not be public`)
  }
}

function validateClipGameRef(value: unknown) {
  const row = objectRecord(value, "clip game")
  validateGameRowFields(row, "clip game")
}

function validateClipPlaybackQuality(value: unknown) {
  const quality = objectRecord(value, "clip playback quality")
  for (const key of ["id", "label"] as const) {
    validateRequiredString(
      quality[key],
      `Invalid clip playback quality response: ${key} is required`,
    )
  }
  for (const key of [
    "bitrate",
    "videoBitrate",
    "audioBitrate",
    "height",
  ] as const) {
    validatePositiveInteger(
      quality[key],
      `Invalid clip playback quality response: ${key} must be a positive integer`,
    )
  }
  validateNullablePositiveInteger(
    quality.width,
    "Invalid clip playback quality response: width must be a positive integer or null",
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
  for (const key of ["id", "authorId", "title", "authorUsername"] as const) {
    validateRequiredString(
      row[key],
      `Invalid clip response: ${key} is required`,
    )
  }
  validatePositiveInteger(
    row.steamgriddbId,
    "Invalid clip response: steamgriddbId must be a positive integer",
  )
}

function validateClipMetadataFields(row: Record<string, unknown>) {
  for (const key of [
    "description",
    "game",
    "sourceContentType",
    "sourceVideoCodec",
    "sourceAudioCodec",
    "openGraphContentType",
    "failureReason",
    "authorImage",
  ] as const) {
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
  for (const key of [
    "sourceSizeBytes",
    "openGraphSizeBytes",
    "durationMs",
  ] as const) {
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
  validateNullableString(
    row.thumbBlurHash,
    "Invalid clip response: thumbBlurHash must be string or null",
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
  validateArray(row.tags, "Invalid clip response: tags must be an array").map(
    (tag) =>
      validateRequiredString(
        tag,
        "Invalid clip response: tag must be a string",
      ),
  )
  validateArray(
    row.playbackQualities,
    "Invalid clip response: playbackQualities must be an array",
  ).map(validateClipPlaybackQuality)
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
