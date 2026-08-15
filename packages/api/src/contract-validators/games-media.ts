import {
  objectRecord,
  validateArray,
  validateBatchProgress,
  validateBoolean,
  validateEnumString,
  validateNonNegativeInteger,
  validateNullablePositiveInteger,
  validateNullableUrlString,
  validateNumber,
  validatePositiveInteger,
  validateRequiredString,
  validateStringArray,
} from "@alloy/api/runtime-validation"
import {
  type AdminGameRow,
  type GameDetail,
  type GameListRow,
  type GameNameLookupResponse,
  type GameRow,
  type SteamGridDBSearchResult,
  type SteamGridDBStatus,
} from "@alloy/contracts"

import type { ApiJsonInput } from "../json-value"
import { validateGameRowFields, validateGameSource } from "./shared"

const GAME_NAME_LOOKUP_REASON = new Set([
  "indexed-exact-name",
  "indexed-normalized-name",
  "steamgriddb-exact-name",
  "steamgriddb-normalized-name",
  "no-match",
  "ambiguous",
])
export function validateGameRow(value: ApiJsonInput): GameRow {
  const row = objectRecord(value, "game")
  validateGameRowFields(row, "game")
  validateGameSource(row, "game")
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as GameRow
}

export function validateGameListRow(value: ApiJsonInput): GameListRow {
  const row = objectRecord(value, "game")
  validateGameRowFields(row, "game")
  validateGameSource(row, "game")
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid game response: clipCount must be a non-negative integer",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as GameListRow
}

export function validateGameListRows(value: ApiJsonInput): GameListRow[] {
  return validateArray(value, "Invalid games response").map(validateGameListRow)
}

export function validateGameRows(value: ApiJsonInput): GameRow[] {
  return validateArray(value, "Invalid games response").map(validateGameRow)
}

export function validateAdminGameRow(value: ApiJsonInput): AdminGameRow {
  // AdminGameRow is structurally a GameRow plus clipCount, same as GameListRow.
  // SAFETY: The checks above validate every field in the asserted response contract.
  return validateGameListRow(value) as AdminGameRow
}

export function validateAdminGameRows(value: ApiJsonInput): AdminGameRow[] {
  return validateArray(value, "Invalid admin games response").map(
    validateAdminGameRow,
  )
}

export function validateGameDetail(value: ApiJsonInput): GameDetail {
  const row = objectRecord(value, "game detail")
  validateGameRowFields(row, "game detail")
  validateGameSource(row, "game detail")
  if (row.viewer !== null) {
    const viewer = objectRecord(row.viewer, "game detail viewer")
    validateBoolean(
      viewer.isFollowing,
      "Invalid game detail response: viewer.isFollowing must be boolean",
    )
  }
  validateNonNegativeInteger(
    row.favouritesCount,
    "Invalid game detail response: favouritesCount must be a non-negative integer",
  )
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid game detail response: clipCount must be a non-negative integer",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as GameDetail
}

export function validateGameNameLookupResponse(
  value: ApiJsonInput,
): GameNameLookupResponse {
  const response = objectRecord(value, "game name lookup")
  const results = validateArray(
    response.results,
    "Invalid game name lookup response: results must be an array",
  )

  for (const item of results) {
    const result = objectRecord(item, "game name lookup result")
    validateRequiredString(
      result.name,
      "Invalid game name lookup response: name is required",
    )
    validateNumber(
      result.confidence,
      "Invalid game name lookup response: confidence must be numeric",
    )
    if (result.confidence < 0 || result.confidence > 1) {
      throw new Error(
        "Invalid game name lookup response: confidence must be between 0 and 1",
      )
    }
    validateEnumString(
      result.reason,
      GAME_NAME_LOOKUP_REASON,
      "Invalid game name lookup response: reason is invalid",
    )
    if (result.game !== null) validateGameRow(result.game)
  }

  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as GameNameLookupResponse
}

export function validateSteamGridDBStatus(
  value: ApiJsonInput,
): SteamGridDBStatus {
  const status = objectRecord(value, "SteamGridDB status")
  validateBoolean(
    status.steamgriddbConfigured,
    "Invalid SteamGridDB status response: steamgriddbConfigured must be boolean",
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as SteamGridDBStatus
}

function validateSteamGridDBSearchResult(
  value: ApiJsonInput,
): SteamGridDBSearchResult {
  const row = objectRecord(value, "game search")
  validatePositiveInteger(
    row.id,
    "Invalid game search response: id must be a positive integer",
  )
  validateRequiredString(
    row.name,
    "Invalid game search response: name is required",
  )
  if (row.release_date !== undefined) {
    validateNullablePositiveInteger(
      row.release_date,
      "Invalid game search response: release_date must be a positive integer or null",
    )
  }
  if (row.types !== undefined) {
    validateStringArray(
      row.types,
      "Invalid game search response: types must be an array of strings",
    )
  }
  if (row.verified !== undefined) {
    validateBoolean(
      row.verified,
      "Invalid game search response: verified must be boolean",
    )
  }
  if (row.iconUrl !== undefined) {
    validateNullableUrlString(
      row.iconUrl,
      "Invalid game search response: iconUrl must be a URL or null",
    )
  }
  if (row.logoUrl !== undefined) {
    validateNullableUrlString(
      row.logoUrl,
      "Invalid game search response: logoUrl must be a URL or null",
    )
  }
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as SteamGridDBSearchResult
}

export function validateSteamGridDBSearchResults(
  value: ApiJsonInput,
): SteamGridDBSearchResult[] {
  return validateArray(value, "Invalid game search response").map(
    validateSteamGridDBSearchResult,
  )
}

export function validateAdminReEncodeResponse(value: ApiJsonInput): {
  enqueued: number
  hasMore: boolean
} {
  return validateBatchProgress(value, "re-encode", "enqueued")
}
