import {
  type AdminEncoderCapabilities,
  ENCODER_HWACCELS,
  type GameDetail,
  type GameListRow,
  type GameRow,
  type MlGameSuggestionResponse,
  type PublicMlConfig,
  type SteamGridDBSearchResult,
  type SteamGridDBStatus,
} from "alloy-contracts"

import {
  objectRecord,
  validateArray,
  validateBatchProgress,
  validateBoolean,
  validateNonNegativeInteger,
  validateNullableRequiredString,
  validateNullableString,
  validateNullableUrlString,
  validatePositiveInteger,
  validateRequiredString,
  validateStringArray,
} from "../runtime-validation"
import { validateGameRowFields } from "./shared"
export function validateGameRow(value: unknown): GameRow {
  const row = objectRecord(value, "game")
  validateGameRowFields(row, "game")
  return value as GameRow
}

export function validateGameListRow(value: unknown): GameListRow {
  const row = objectRecord(value, "game")
  validateGameRowFields(row, "game")
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid game response: clipCount must be a non-negative integer",
  )
  return value as GameListRow
}

export function validateGameListRows(value: unknown): GameListRow[] {
  return validateArray(value, "Invalid games response").map(validateGameListRow)
}

export function validateGameDetail(value: unknown): GameDetail {
  const row = objectRecord(value, "game detail")
  validateGameRowFields(row, "game detail")
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
  return value as GameDetail
}

export function validateSteamGridDBStatus(value: unknown): SteamGridDBStatus {
  const status = objectRecord(value, "SteamGridDB status")
  validateBoolean(
    status.steamgriddbConfigured,
    "Invalid SteamGridDB status response: steamgriddbConfigured must be boolean",
  )
  return value as SteamGridDBStatus
}

function validateSteamGridDBSearchResult(
  value: unknown,
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
    validatePositiveInteger(
      row.release_date,
      "Invalid game search response: release_date must be a positive integer",
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
  return value as SteamGridDBSearchResult
}

export function validateSteamGridDBSearchResults(
  value: unknown,
): SteamGridDBSearchResult[] {
  return validateArray(value, "Invalid game search response").map(
    validateSteamGridDBSearchResult,
  )
}

export function validateAdminEncoderCapabilities(
  value: unknown,
): AdminEncoderCapabilities {
  const capabilities = objectRecord(value, "encoder capabilities")
  validateBoolean(
    capabilities.ffmpegOk,
    "Invalid encoder capabilities response: ffmpegOk must be boolean",
  )
  validateNullableString(
    capabilities.ffmpegVersion,
    "Invalid encoder capabilities response: ffmpegVersion must be string or null",
  )
  const available = objectRecord(
    capabilities.available,
    "encoder capabilities available",
  )
  for (const hwaccel of ENCODER_HWACCELS) {
    const hw = objectRecord(available[hwaccel], "encoder capabilities hwaccel")
    for (const codec of ["h264", "hevc", "av1"] as const) {
      validateBoolean(
        hw[codec],
        `Invalid encoder capabilities response: ${hwaccel}.${codec} must be boolean`,
      )
    }
  }
  return value as AdminEncoderCapabilities
}

export function validateAdminReEncodeResponse(value: unknown): {
  enqueued: number
  hasMore: boolean
} {
  return validateBatchProgress(value, "re-encode", "enqueued")
}

export function validatePublicMlConfig(value: unknown): PublicMlConfig {
  const config = objectRecord(value, "machine learning config")
  validateBoolean(
    config.enabled,
    "Invalid machine learning config: enabled must be boolean",
  )
  const gameSuggestion = objectRecord(
    config.gameSuggestion,
    "machine learning game suggestion config",
  )
  for (const key of [
    "frameCount",
    "frameMaxWidth",
    "maxFrames",
    "maxFrameBytes",
  ] as const) {
    validatePositiveInteger(
      gameSuggestion[key],
      `Invalid machine learning config: gameSuggestion.${key} must be a positive integer`,
    )
  }
  return value as PublicMlConfig
}

export function validateMlGameSuggestionResponse(
  value: unknown,
): MlGameSuggestionResponse {
  const response = objectRecord(value, "machine learning game suggestions")
  if (response.kind !== "game-suggestion" || response.advisory !== true) {
    throw new Error("Invalid machine learning response: unexpected kind")
  }
  validateRequiredString(
    response.modelName,
    "Invalid machine learning response: modelName is required",
  )
  validateNullableRequiredString(
    response.modelVersion,
    "Invalid machine learning response: invalid modelVersion",
  )
  const predictions = validateArray(
    response.predictions,
    "Invalid machine learning response: predictions must be an array",
  )
  for (const [index, item] of predictions.entries()) {
    const prediction = objectRecord(item, "machine learning prediction")
    validatePositiveInteger(
      prediction.rank,
      "Invalid machine learning response: rank must be a positive integer",
    )
    if (prediction.rank !== index + 1) {
      throw new Error("Invalid machine learning response: rank is out of order")
    }
    validateRequiredString(
      prediction.label,
      "Invalid machine learning response: label is required",
    )
    if (
      typeof prediction.score !== "number" ||
      !Number.isFinite(prediction.score) ||
      prediction.score < 0 ||
      prediction.score > 1
    ) {
      throw new Error(
        "Invalid machine learning response: score must be between 0 and 1",
      )
    }
  }
  return value as MlGameSuggestionResponse
}
