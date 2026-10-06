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
  validateOptionalUrlString,
  validatePositiveInteger,
  validateRequiredString,
  validateString,
  validateStringArray,
  validateUrlString,
} from "@alloy/api/runtime-validation"
import {
  type AdminGameRow,
  type GameDetail,
  type GameListRow,
  type GameNameLookupResponse,
  type GameRow,
  type SteamGridDBAsset,
  type SteamGridDBArtworkResponse,
  type SteamGridDBSearchResult,
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

function validateSteamGridDBAsset(value: ApiJsonInput): SteamGridDBAsset {
  const asset = objectRecord(value, "game artwork")
  validatePositiveInteger(
    asset.id,
    "Invalid game artwork response: id must be a positive integer",
  )
  validateUrlString(
    asset.url,
    "Invalid game artwork response: url must be a URL",
  )
  validateOptionalUrlString(
    asset.thumb,
    "Invalid game artwork response: thumb must be a URL",
  )
  // SteamGridDB reports 0x0 for assets it could not measure, so these stay
  // non-negative rather than positive.
  if (asset.width !== undefined) {
    validateNonNegativeInteger(
      asset.width,
      "Invalid game artwork response: width must be a non-negative integer",
    )
  }
  if (asset.height !== undefined) {
    validateNonNegativeInteger(
      asset.height,
      "Invalid game artwork response: height must be a non-negative integer",
    )
  }
  if (asset.style !== undefined) {
    validateString(
      asset.style,
      "Invalid game artwork response: style must be a string",
    )
  }
  if (asset.nsfw !== undefined) {
    validateBoolean(
      asset.nsfw,
      "Invalid game artwork response: nsfw must be boolean",
    )
  }
  if (asset.humor !== undefined) {
    validateBoolean(
      asset.humor,
      "Invalid game artwork response: humor must be boolean",
    )
  }
  // SAFETY: Every field above validated against the SteamGridDBAsset contract.
  return value as SteamGridDBAsset
}

export function validateSteamGridDBArtworkResponse(
  value: ApiJsonInput,
): SteamGridDBArtworkResponse {
  const response = objectRecord(value, "game artwork")
  const assets = validateArray(
    response.assets,
    "Invalid game artwork response: assets must be an array",
  )
  for (const asset of assets) validateSteamGridDBAsset(asset)
  // SAFETY: The assets array and every entry validated against the contract.
  return value as SteamGridDBArtworkResponse
}
