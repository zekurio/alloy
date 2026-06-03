import {
  objectRecord,
  validateBoolean,
  validateNonNegativeInteger,
  validateNonNegativeNumber,
  validateNullableDateString,
  validateNullableUrlString,
  validateOptionalString,
  validatePositiveInteger,
  validateRequiredString,
} from "../runtime-validation"

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
