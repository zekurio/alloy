import {
  CLIP_PRIVACY,
  CLIP_STATUS,
  type ClipPage,
  type ClipRow,
} from "@workspace/contracts"
import {
  objectRecord,
  validateArray,
  validateBoolean,
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
  validateString,
} from "../runtime-validation"
import { validateGameRowFields } from "./shared"
import { validateUserSummary } from "./people-notifications"
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
