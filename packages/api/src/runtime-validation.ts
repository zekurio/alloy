import {
  GAME_ASSET_PATH_PREFIX,
  isBooleanValue,
  isFiniteNumberValue,
  isObjectRecord,
  isStringValue,
} from "@alloy/contracts"

import type { ApiJsonInput, ApiJsonValue } from "./json-value"

export function objectRecord(
  value: ApiJsonInput,
  label: string,
): Record<string, ApiJsonValue> {
  if (!isObjectRecord(value)) {
    throw new Error(`Invalid ${label} response`)
  }
  return value
}

export function validateArray(
  value: ApiJsonInput,
  message: string,
): ApiJsonValue[] {
  if (!Array.isArray(value)) throw new Error(message)
  return value
}

export function validateStringArray(
  value: ApiJsonInput,
  message: string,
): string[] {
  const items = validateArray(value, message)
  if (items.some((item) => !isStringValue(item))) throw new Error(message)
  // SAFETY: Every array element passed the string schema check above.
  return items as string[]
}

export function validateStringRecord(
  value: ApiJsonInput,
  label: string,
  message: string,
): Record<string, string> {
  const record = objectRecord(value, label)
  for (const [key, item] of Object.entries(record)) {
    if (!key.trim() || !isStringValue(item)) throw new Error(message)
  }
  // SAFETY: Every record entry passed the non-empty key and string value checks.
  return record as Record<string, string>
}

export function validateBatchProgress<T extends string>(
  value: ApiJsonInput,
  label: string,
  countKey: T,
): Record<T, number> & { hasMore: boolean } {
  const response = objectRecord(value, label)
  validateNonNegativeInteger(
    response[countKey],
    `Invalid ${label} response: ${countKey} must be a non-negative integer`,
  )
  validateBoolean(
    response.hasMore,
    `Invalid ${label} response: hasMore must be boolean`,
  )
  // SAFETY: The dynamic count field and hasMore field passed their checks above.
  return value as Record<T, number> & { hasMore: boolean }
}

export function validateBoolean(value: ApiJsonInput, message: string) {
  if (!isBooleanValue(value)) throw new Error(message)
}

export function validateString(
  value: ApiJsonInput,
  message: string,
): asserts value is string {
  if (!isStringValue(value)) throw new Error(message)
}

export function validateEnumString(
  value: ApiJsonInput,
  allowedValues: ReadonlySet<string>,
  message: string,
): asserts value is string {
  if (!isStringValue(value) || !allowedValues.has(value)) {
    throw new Error(message)
  }
}

export function validateNullableEnumString(
  value: ApiJsonInput,
  allowedValues: ReadonlySet<string>,
  message: string,
): asserts value is string | null {
  if (value !== null) validateEnumString(value, allowedValues, message)
}

export function validateRequiredString(
  value: ApiJsonInput,
  message: string,
): asserts value is string {
  if (!isStringValue(value) || !value.trim()) throw new Error(message)
}

export function validateOptionalString(value: ApiJsonInput, message: string) {
  if (value !== undefined) validateString(value, message)
}

export function validateUrlString(
  value: ApiJsonInput,
  message: string,
): asserts value is string {
  if (!isStringValue(value)) throw new Error(message)
  try {
    new URL(value)
  } catch {
    throw new Error(message)
  }
}

export function validateOptionalUrlString(
  value: ApiJsonInput,
  message: string,
) {
  if (value !== undefined) validateUrlString(value, message)
}

const PUBLIC_IMAGE_SRC_BASE_URL = "https://alloy.local"
const PUBLIC_IMAGE_SRC_BASE_ORIGIN = new URL(PUBLIC_IMAGE_SRC_BASE_URL).origin

function isHttpUrlString(value: string) {
  if (!URL.canParse(value)) return false

  const url = new URL(value)
  return url.protocol === "http:" || url.protocol === "https:"
}

function hasControlCharacter(value: string) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function isPublicAssetPath(value: string) {
  if (
    !value.startsWith(GAME_ASSET_PATH_PREFIX) ||
    value.includes("\\") ||
    hasControlCharacter(value) ||
    !URL.canParse(value, PUBLIC_IMAGE_SRC_BASE_URL)
  ) {
    return false
  }

  const url = new URL(value, PUBLIC_IMAGE_SRC_BASE_URL)
  return (
    url.origin === PUBLIC_IMAGE_SRC_BASE_ORIGIN &&
    url.pathname.startsWith(GAME_ASSET_PATH_PREFIX)
  )
}

export function validatePublicImageSrcString(
  value: ApiJsonInput,
  message: string,
): asserts value is string {
  validateString(value, message)
  if (isHttpUrlString(value) || isPublicAssetPath(value)) return
  throw new Error(message)
}

export function validateNullablePublicImageSrcString(
  value: ApiJsonInput,
  message: string,
): asserts value is string | null {
  if (value !== null) validatePublicImageSrcString(value, message)
}

export function validateNullableUrlString(
  value: ApiJsonInput,
  message: string,
): asserts value is string | null {
  if (value !== null) validateUrlString(value, message)
}

export function validateNullableString(
  value: ApiJsonInput,
  message: string,
): asserts value is string | null {
  if (value !== null) validateString(value, message)
}

export function validateNullableRequiredString(
  value: ApiJsonInput,
  message: string,
): asserts value is string | null {
  if (value !== null) validateRequiredString(value, message)
}

export function validateNumber(
  value: ApiJsonInput,
  message: string,
): asserts value is number {
  if (!isFiniteNumberValue(value)) {
    throw new Error(message)
  }
}

export function validatePositiveInteger(value: ApiJsonInput, message: string) {
  validateNumber(value, message)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(message)
  }
}

export function validateNonNegativeInteger(
  value: ApiJsonInput,
  message: string,
): asserts value is number {
  validateNumber(value, message)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(message)
  }
}

export function validateNullableNonNegativeInteger(
  value: ApiJsonInput,
  message: string,
) {
  if (value !== null) validateNonNegativeInteger(value, message)
}

export function validateNullablePositiveInteger(
  value: ApiJsonInput,
  message: string,
) {
  if (value !== null) validatePositiveInteger(value, message)
}

export function validateIntegerInRange(
  value: ApiJsonInput,
  min: number,
  max: number,
  message: string,
) {
  validateNumber(value, message)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(message)
  }
}

export function validateNonNegativeNumber(
  value: ApiJsonInput,
  message: string,
): number {
  validateNumber(value, message)
  if (value < 0) {
    throw new Error(message.replace("numeric", "non-negative"))
  }
  return value
}

function isCanonicalIsoDateString(value: string): boolean {
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

export function validateIsoDateString(
  value: ApiJsonInput,
  message: string,
): asserts value is string {
  if (
    !isStringValue(value) ||
    !value.trim() ||
    !isCanonicalIsoDateString(value)
  ) {
    throw new Error(message)
  }
}

export function validateNullableDateString(
  value: ApiJsonInput,
  message: string,
) {
  if (value !== null) validateIsoDateString(value, message)
}
