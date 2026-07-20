import {
  objectRecord,
  validateArray,
  validateBatchProgress,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNullableDateString,
  validateNullableString,
  validateRequiredString,
} from "@alloy/api/runtime-validation"
import {
  type GameCreatorsResponse,
  type UserListRow,
  type UserSummary,
} from "@alloy/contracts"

export function validateUserSummary(
  value: unknown,
  label = "user",
): UserSummary {
  const row = objectRecord(value, label)
  for (const key of ["id", "username", "displayName"] as const) {
    validateRequiredString(
      row[key],
      `Invalid ${label} response: ${key} is required`,
    )
  }
  validateNullableString(
    row.image,
    `Invalid ${label} response: image must be string or null`,
  )
  return value as UserSummary
}

export function validateUserSummaries(value: unknown): UserSummary[] {
  return validateArray(value, "Invalid users response").map((item) =>
    validateUserSummary(item),
  )
}

export function validateUserListRow(value: unknown): UserListRow {
  const row = objectRecord(value, "user list")
  validateUserSummary(row, "user list")
  validateIsoDateString(
    row.createdAt,
    "Invalid user list response: createdAt must be a date string",
  )
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid user list response: clipCount must be a non-negative integer",
  )
  return value as UserListRow
}

export function validateGameCreatorsResponse(
  value: unknown,
): GameCreatorsResponse {
  const response = objectRecord(value, "game creators")
  validateArray(
    response.creators,
    "Invalid game creators response: creators must be an array",
  ).map((item) => {
    const row = objectRecord(item, "game creator")
    validateUserSummary(row, "game creator")
    validateNonNegativeInteger(
      row.clipCount,
      "Invalid game creators response: clipCount must be a non-negative integer",
    )
    return row
  })
  return value as GameCreatorsResponse
}

export function validateAccountStateResponse(value: unknown): {
  disabledAt: string | null
} {
  validateAccountDisabledAt(value, "account state", "nullable")
  return value as { disabledAt: string | null }
}

export function validateDisableAccountResponse(value: unknown): {
  disabledAt: string
} {
  validateAccountDisabledAt(value, "disable account", "date")
  return value as { disabledAt: string }
}

export function validateReactivateAccountResponse(value: unknown): {
  disabledAt: null
} {
  validateAccountDisabledAt(value, "reactivate account", "null")
  return value as { disabledAt: null }
}

function validateAccountDisabledAt(
  value: unknown,
  label: string,
  mode: "nullable" | "date" | "null",
): void {
  const response = objectRecord(value, label)
  if (mode === "nullable") {
    validateNullableDateString(
      response.disabledAt,
      `Invalid ${label} response: disabledAt must be a date string or null`,
    )
    return
  }
  if (mode === "date") {
    validateIsoDateString(
      response.disabledAt,
      `Invalid ${label} response: disabledAt must be a date string`,
    )
    return
  }
  if (response.disabledAt !== null) {
    throw new Error(`Invalid ${label} response: disabledAt must be null`)
  }
}

export function validateDeleteClipsResponse(value: unknown): {
  deleted: number
  hasMore: boolean
} {
  return validateBatchProgress(value, "delete clips", "deleted")
}
