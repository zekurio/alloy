import {
  objectRecord,
  validateArray,
  validateBatchProgress,
  validateIsoDateString,
  validateNonNegativeInteger,
  validateNullableString,
  validateRequiredString,
} from "@alloy/api/runtime-validation"
import {
  type ContractJsonInput,
  type GameCreatorsResponse,
  type UserListRow,
  type UserSummary,
} from "@alloy/contracts"

export function validateUserSummary(
  value: ContractJsonInput,
  label = "user",
): UserSummary {
  const row = objectRecord(value, label)
  for (const key of ["id", "username"] as const) {
    validateRequiredString(
      row[key],
      `Invalid ${label} response: ${key} is required`,
    )
  }
  for (const key of ["displayName", "image"] as const) {
    validateNullableString(
      row[key],
      `Invalid ${label} response: ${key} must be string or null`,
    )
  }
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as UserSummary
}

export function validateUserSummaries(value: ContractJsonInput): UserSummary[] {
  return validateArray(value, "Invalid users response").map((item) =>
    validateUserSummary(item),
  )
}

export function validateUserListRow(value: ContractJsonInput): UserListRow {
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
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as UserListRow
}

export function validateGameCreatorsResponse(
  value: ContractJsonInput,
): GameCreatorsResponse {
  const response = objectRecord(value, "game creators")
  validateArray(
    response.creators,
    "Invalid game creators response: creators must be an array",
  ).map((item) => {
    const row = objectRecord(item, "game creator")
    // The creators query does not select display_name yet. Read a missing
    // value as "not set" until it does.
    row.displayName ??= null
    validateUserSummary(row, "game creator")
    validateNonNegativeInteger(
      row.clipCount,
      "Invalid game creators response: clipCount must be a non-negative integer",
    )
    return row
  })
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as GameCreatorsResponse
}

export function validateDisableAccountResponse(value: ContractJsonInput): {
  disabledAt: string
} {
  validateAccountDisabledAt(value, "disable account", "date")
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as { disabledAt: string }
}

export function validateReactivateAccountResponse(value: ContractJsonInput): {
  disabledAt: null
} {
  validateAccountDisabledAt(value, "reactivate account", "null")
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as { disabledAt: null }
}

function validateAccountDisabledAt(
  value: ContractJsonInput,
  label: string,
  mode: "date" | "null",
): void {
  const response = objectRecord(value, label)
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

export function validateDeleteClipsResponse(value: ContractJsonInput): {
  deleted: number
  hasMore: boolean
} {
  return validateBatchProgress(value, "delete clips", "deleted")
}
