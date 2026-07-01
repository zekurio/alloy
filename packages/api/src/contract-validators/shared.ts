import {
  objectRecord,
  validateBoolean,
  validateEnumString,
  validateNonNegativeInteger,
  validateNonNegativeNumber,
  validateNullableDateString,
  validateNullablePublicImageSrcString,
  validateNullablePositiveInteger,
  validateNullableString,
  validateOptionalString,
  validateRequiredString,
} from "@alloy/api/runtime-validation"
import { GAME_SOURCE } from "@alloy/contracts"
import { isBlurHash } from "@alloy/contracts/blurhash"

const GAME_SOURCE_SET: ReadonlySet<string> = new Set(GAME_SOURCE)

export function validateAuthProviderColors(
  provider: Record<string, unknown>,
  label: string,
) {
  for (const key of ["buttonColor", "buttonTextColor"] as const) {
    validateOptionalString(
      provider[key],
      `Invalid ${label}: ${key} must be a string`,
    )
  }
}

export function validateLikeState(
  value: unknown,
  label: "clip" | "comment",
): void {
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

export function validateGameRowFields(
  row: Record<string, unknown>,
  label: string,
) {
  validateRequiredString(row.id, `Invalid ${label} response: id is required`)
  for (const key of ["name", "slug"] as const) {
    validateRequiredString(
      row[key],
      `Invalid ${label} response: ${key} is required`,
    )
  }
  validateNullablePositiveInteger(
    row.steamgriddbId,
    `Invalid ${label} response: steamgriddbId must be a positive integer or null`,
  )
  validateNullableDateString(
    row.releaseDate,
    `Invalid ${label} response: releaseDate must be a date string or null`,
  )
  for (const key of ["heroUrl", "gridUrl", "logoUrl", "iconUrl"] as const) {
    validateNullablePublicImageSrcString(
      row[key],
      `Invalid ${label} response: ${key} must be an image URL or public asset path`,
    )
  }
  for (const key of ["heroBlurHash", "gridBlurHash"] as const) {
    validateNullableBlurHash(row[key], `Invalid ${label} response: ${key}`)
  }
}

export function validateGameSource(
  row: Record<string, unknown>,
  label: string,
): void {
  validateEnumString(
    row.source,
    GAME_SOURCE_SET,
    `Invalid ${label} response: source is invalid`,
  )
}

export function validateNullableBlurHash(value: unknown, label: string): void {
  validateNullableString(value, `${label} must be string or null`)
  if (value !== null && !isBlurHash(value)) {
    throw new Error(`${label} must be a valid BlurHash`)
  }
}

export function validateBackdropTreatment(
  splash: Record<string, unknown>,
  label: string,
) {
  validateNonNegativeNumber(
    splash.blurPx,
    `Invalid ${label}: blurPx must be a non-negative number`,
  )
  if (Number(splash.blurPx) > 48) {
    throw new Error(`Invalid ${label}: blurPx must be at most 48`)
  }
  validateNonNegativeNumber(
    splash.darkenOpacity,
    `Invalid ${label}: darkenOpacity must be a non-negative number`,
  )
  if (Number(splash.darkenOpacity) > 1) {
    throw new Error(`Invalid ${label}: darkenOpacity must be at most 1`)
  }
}
