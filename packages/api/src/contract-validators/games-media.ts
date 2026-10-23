import {
  objectRecord,
  validateArray,
  validateBoolean,
  validateEnumString,
  validateNonNegativeInteger,
  validateNullableDateString,
  validateNullablePositiveInteger,
  validateNullablePublicImageSrcString,
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
  type ContractJsonInput,
  GAME_NAME_LOOKUP_REASONS,
  GAME_SOURCE,
  type GameDetail,
  type GameListRow,
  type GameNameLookupResponse,
  type GameRow,
  type SteamGridDBArtworkResponse,
  type SteamGridDBAsset,
  type SteamGridDBSearchResult,
} from "@alloy/contracts"

import { validateNullableBlurHash } from "./shared"

const GAME_SOURCE_SET: ReadonlySet<string> = new Set(GAME_SOURCE)
const GAME_NAME_LOOKUP_REASON_SET: ReadonlySet<string> = new Set(
  GAME_NAME_LOOKUP_REASONS,
)
const GAME_IMAGE_KEYS = ["heroUrl", "gridUrl", "logoUrl", "iconUrl"] as const

export function validateGameRow(
  value: ContractJsonInput,
  label = "game",
): GameRow {
  const row = objectRecord(value, label)
  validateRequiredString(row.id, `Invalid ${label} response: id is required`)
  for (const key of ["name", "slug"] as const) {
    validateRequiredString(
      row[key],
      `Invalid ${label} response: ${key} is required`,
    )
  }
  validateEnumString(
    row.source,
    GAME_SOURCE_SET,
    `Invalid ${label} response: source is invalid`,
  )
  validateNullablePositiveInteger(
    row.steamgriddbId,
    `Invalid ${label} response: steamgriddbId must be a positive integer or null`,
  )
  validateNullableDateString(
    row.releaseDate,
    `Invalid ${label} response: releaseDate must be a date string or null`,
  )
  for (const key of GAME_IMAGE_KEYS) {
    validateNullablePublicImageSrcString(
      row[key],
      `Invalid ${label} response: ${key} must be an image URL or public asset path`,
    )
  }
  for (const key of ["heroBlurHash", "gridBlurHash"] as const) {
    validateNullableBlurHash(row[key], `Invalid ${label} response: ${key}`)
  }
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as GameRow
}

export function validateGameListRow(
  value: ContractJsonInput,
  label = "game",
): GameListRow {
  const row = objectRecord(value, label)
  validateGameRow(row, label)
  validateNonNegativeInteger(
    row.clipCount,
    `Invalid ${label} response: clipCount must be a non-negative integer`,
  )
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as GameListRow
}

export function validateGameListRows(value: ContractJsonInput): GameListRow[] {
  return validateArray(value, "Invalid games response").map((item) =>
    validateGameListRow(item),
  )
}

export function validateGameRows(value: ContractJsonInput): GameRow[] {
  return validateArray(value, "Invalid games response").map((item) =>
    validateGameRow(item),
  )
}

export function validateAdminGameRow(value: ContractJsonInput): AdminGameRow {
  return validateGameListRow(value, "admin game")
}

export function validateAdminGameRows(
  value: ContractJsonInput,
): AdminGameRow[] {
  return validateArray(value, "Invalid admin games response").map(
    validateAdminGameRow,
  )
}

export function validateGameDetail(value: ContractJsonInput): GameDetail {
  return validateGameListRow(value, "game detail")
}

export function validateGameNameLookupResponse(
  value: ContractJsonInput,
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
      GAME_NAME_LOOKUP_REASON_SET,
      "Invalid game name lookup response: reason is invalid",
    )
    if (result.game !== null) validateGameRow(result.game)
  }

  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as GameNameLookupResponse
}

function validateSteamGridDBSearchResult(
  value: ContractJsonInput,
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
  // Games the catalogue already knows answer with their stored artwork, which
  // is a public asset path when an admin uploaded it.
  for (const key of GAME_IMAGE_KEYS) {
    if (row[key] === undefined) continue
    validateNullablePublicImageSrcString(
      row[key],
      `Invalid game search response: ${key} must be an image URL or public asset path`,
    )
  }
  // SAFETY: The checks above validate every field in the asserted response contract.
  return value as SteamGridDBSearchResult
}

export function validateSteamGridDBSearchResults(
  value: ContractJsonInput,
): SteamGridDBSearchResult[] {
  return validateArray(value, "Invalid game search response").map(
    validateSteamGridDBSearchResult,
  )
}

function validateSteamGridDBAsset(value: ContractJsonInput): SteamGridDBAsset {
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
  value: ContractJsonInput,
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
