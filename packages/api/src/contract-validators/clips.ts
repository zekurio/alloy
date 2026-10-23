import {
  objectRecord,
  validateArray,
  validateEnumString,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNullableDateString,
  validateNullableNonNegativeInteger,
  validateNullablePositiveInteger,
  validateNullableRequiredString,
  validateNullableString,
  validateRequiredString,
  validateString,
} from "@alloy/api/runtime-validation"
import {
  CLIP_PRIVACY,
  type ClipPage,
  type ClipRow,
  MEDIA_KINDS,
} from "@alloy/contracts"

import type { ApiJsonInput, ApiJsonValue } from "../json-value"
import { validateGameRow } from "./games-media"
import { validateUserSummary } from "./people"
import {
  CLIP_STATUS_SET,
  validateEncodeFields,
  validateNullableBlurHash,
} from "./shared"
const CLIP_PRIVACY_SET: ReadonlySet<string> = new Set(CLIP_PRIVACY)
const MEDIA_KIND_SET: ReadonlySet<string> = new Set(MEDIA_KINDS)
function assertNoStorageKey(
  value: Record<string, ApiJsonValue>,
  label: string,
) {
  if ("storageKey" in value) {
    throw new Error(`Invalid ${label} response: storageKey must not be public`)
  }
}

export function validateClipRow(value: ApiJsonInput): ClipRow {
  const row = objectRecord(value, "clip")
  validateEnumString(
    row.mediaKind,
    MEDIA_KIND_SET,
    "Invalid clip response: mediaKind is invalid",
  )
  assertNoStorageKey(row, "clip")
  validateClipIdentityFields(row)
  validateClipMetadataFields(row)
  validateClipCounters(row)
  validateEncodeFields(row, "clip")
  validateClipTimestamps(row)
  validateClipRelationships(row)
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as ClipRow
}

function validateClipIdentityFields(row: Record<string, ApiJsonValue>) {
  for (const key of ["id", "authorId", "title", "authorUsername"] as const) {
    validateRequiredString(
      row[key],
      `Invalid clip response: ${key} is required`,
    )
  }
  validateNullableRequiredString(
    row.gameId,
    "Invalid clip response: gameId must be a non-empty string or null",
  )
}

function validateClipMetadataFields(row: Record<string, ApiJsonValue>) {
  for (const key of [
    "description",
    "game",
    "sourceContentType",
    "playbackContentType",
    "sourceVideoCodec",
    "sourceAudioCodec",
    "sourceCodecs",
    "failureReason",
    "authorDisplayName",
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

function validateClipCounters(row: Record<string, ApiJsonValue>) {
  for (const key of [
    "sourceSizeBytes",
    "sourceDurationMs",
    "durationMs",
    "trimStartMs",
    "trimEndMs",
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
  validateNonNegativeInteger(
    row.viewCount,
    "Invalid clip response: viewCount must be a non-negative integer",
  )
}

function validateClipTimestamps(row: Record<string, ApiJsonValue>) {
  validateIsoDateString(
    row.createdAt,
    "Invalid clip response: createdAt must be a date string",
  )
  validateIsoDateString(
    row.updatedAt,
    "Invalid clip response: updatedAt must be a date string",
  )
  validateNullableDateString(
    row.publishedAt,
    "Invalid clip response: publishedAt must be a nullable date string",
  )
  validateNullableString(
    row.thumbKey,
    "Invalid clip response: thumbKey must be string or null",
  )
  validateNullableString(
    row.thumbVersion,
    "Invalid clip response: thumbVersion must be string or null",
  )
  validateNullableString(
    row.sourceVersion,
    "Invalid clip response: sourceVersion must be string or null",
  )
  validateNullableString(
    row.waveformVersion,
    "Invalid clip response: waveformVersion must be string or null",
  )
  validateNullableBlurHash(
    row.thumbBlurHash,
    "Invalid clip response: thumbBlurHash",
  )
}

function validateClipRelationships(row: Record<string, ApiJsonValue>) {
  if (row.gameRef !== null) {
    validateGameRow(row.gameRef, "clip game")
  }
  validateArray(
    row.renditions,
    "Invalid clip response: renditions must be an array",
  ).map((entry) => {
    const rendition = objectRecord(entry, "clip rendition")
    assertNoStorageKey(rendition, "clip rendition")
    if ("key" in rendition) {
      throw new Error("Invalid clip rendition response: key must not be public")
    }
    for (const key of ["height", "width", "fps"] as const) {
      validateNonNegativeInteger(
        rendition[key],
        `Invalid clip rendition response: ${key} must be a non-negative integer`,
      )
    }
    validateRequiredString(
      rendition.name,
      "Invalid clip rendition response: name is required",
    )
    validateString(
      rendition.codecs,
      "Invalid clip rendition response: codecs must be a string",
    )
    validateRequiredString(
      rendition.version,
      "Invalid clip rendition response: version is required",
    )
  })
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
}

export function validateClipRows(value: ApiJsonInput): ClipRow[] {
  return validateArray(value, "Invalid clips response").map(validateClipRow)
}

export function validateClipPage(value: ApiJsonInput): ClipPage {
  const page = objectRecord(value, "clips")
  validateArray(
    page.items,
    "Invalid clips response: items must be an array",
  ).map(validateClipRow)
  validateNullableRequiredString(
    page.nextCursor,
    "Invalid clips response: nextCursor must be a non-empty string or null",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as ClipPage
}
