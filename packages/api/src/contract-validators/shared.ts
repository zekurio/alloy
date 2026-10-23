import {
  validateBoolean,
  validateIntegerInRange,
  validateNonNegativeNumber,
  validateNullableEnumString,
  validateNullablePositiveInteger,
  validateNullableString,
  validateOptionalString,
} from "@alloy/api/runtime-validation"
import {
  CLIP_STATUS,
  type ContractJsonInput,
  type ContractJsonValue,
  ENCODE_STAGE,
  LOGIN_SPLASH_MAX_BLUR_PX,
  LOGIN_SPLASH_MAX_DARKEN_OPACITY,
  USER_ROLES,
  USER_STATUSES,
} from "@alloy/contracts"
import { isBlurHash } from "@alloy/contracts/blurhash"

export const USER_ROLE_SET: ReadonlySet<string> = new Set(USER_ROLES)
export const USER_STATUS_SET: ReadonlySet<string> = new Set(USER_STATUSES)
export const CLIP_STATUS_SET: ReadonlySet<string> = new Set(CLIP_STATUS)
const ENCODE_STAGE_SET: ReadonlySet<string> = new Set(ENCODE_STAGE)

export function validateAuthProviderColors(
  provider: Record<string, ContractJsonValue>,
  label: string,
) {
  for (const key of ["buttonColor", "buttonTextColor"] as const) {
    validateOptionalString(
      provider[key],
      `Invalid ${label}: ${key} must be a string`,
    )
  }
}

/** Encode progress fields shared by clip rows and upload queue rows. */
export function validateEncodeFields(
  row: Record<string, ContractJsonValue>,
  label: string,
) {
  validateBoolean(
    row.encodeActive,
    `Invalid ${label} response: encodeActive must be boolean`,
  )
  validateIntegerInRange(
    row.encodeProgress,
    0,
    100,
    `Invalid ${label} response: encodeProgress must be an integer between 0 and 100`,
  )
  validateNullableEnumString(
    row.encodeStage,
    ENCODE_STAGE_SET,
    `Invalid ${label} response: encodeStage is invalid`,
  )
  validateNullableString(
    row.encodeTier,
    `Invalid ${label} response: encodeTier must be string or null`,
  )
  for (const key of ["encodeTierIndex", "encodeTierCount"] as const) {
    validateNullablePositiveInteger(
      row[key],
      `Invalid ${label} response: ${key} must be a positive integer or null`,
    )
  }
}

export function validateNullableBlurHash(
  value: ContractJsonInput,
  label: string,
): void {
  validateNullableString(value, `${label} must be string or null`)
  if (value !== null && !isBlurHash(value)) {
    throw new Error(`${label} must be a valid BlurHash`)
  }
}

export function validateBackdropTreatment(
  splash: Record<string, ContractJsonValue>,
  label: string,
) {
  validateNonNegativeNumber(
    splash.blurPx,
    `Invalid ${label}: blurPx must be a non-negative number`,
  )
  if (Number(splash.blurPx) > LOGIN_SPLASH_MAX_BLUR_PX) {
    throw new Error(
      `Invalid ${label}: blurPx must be at most ${LOGIN_SPLASH_MAX_BLUR_PX}`,
    )
  }
  validateNonNegativeNumber(
    splash.darkenOpacity,
    `Invalid ${label}: darkenOpacity must be a non-negative number`,
  )
  if (Number(splash.darkenOpacity) > LOGIN_SPLASH_MAX_DARKEN_OPACITY) {
    throw new Error(
      `Invalid ${label}: darkenOpacity must be at most ${LOGIN_SPLASH_MAX_DARKEN_OPACITY}`,
    )
  }
}
