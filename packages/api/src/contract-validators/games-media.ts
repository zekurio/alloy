import {
  type AdminEncoderCapabilities,
  type AdminScheduledTaskInfo,
  type AdminScheduledTaskRunResponse,
  type AdminScheduledTasksResponse,
  ENCODER_HWACCELS,
  type GameDetail,
  type GameListRow,
  type GameNameLookupResponse,
  type GameRow,
  type SteamGridDBSearchResult,
  type SteamGridDBStatus,
} from "alloy-contracts"

import {
  objectRecord,
  validateArray,
  validateBatchProgress,
  validateBoolean,
  validateEnumString,
  validateNonNegativeInteger,
  validateNullableDateString,
  validateNullableEnumString,
  validateNullableNonNegativeInteger,
  validateNullableString,
  validateNullableUrlString,
  validatePositiveInteger,
  validateRequiredString,
  validateStringArray,
} from "../runtime-validation"
import { validateGameRowFields } from "./shared"

const GAME_NAME_LOOKUP_REASON = new Set([
  "indexed-exact-name",
  "indexed-normalized-name",
  "steamgriddb-exact-name",
  "steamgriddb-normalized-name",
  "no-match",
  "ambiguous",
])
const SCHEDULED_TASK_STATE = new Set(["idle", "running"])
const SCHEDULED_TASK_RUN_TRIGGER = new Set(["startup", "cron", "manual"])
const SCHEDULED_TASK_STATUS = new Set(["success", "failed", "cancelled"])

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

export function validateGameNameLookupResponse(
  value: unknown,
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
    if (
      typeof result.confidence !== "number" ||
      !Number.isFinite(result.confidence) ||
      result.confidence < 0 ||
      result.confidence > 1
    ) {
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

  return value as GameNameLookupResponse
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

export function validateAdminScheduledTasksResponse(
  value: unknown,
): AdminScheduledTasksResponse {
  const response = objectRecord(value, "scheduled tasks")
  response.tasks = validateArray(
    response.tasks,
    "Invalid scheduled tasks response: tasks must be an array",
  ).map(validateAdminScheduledTaskInfo)
  return value as AdminScheduledTasksResponse
}

export function validateAdminScheduledTaskInfo(
  value: unknown,
): AdminScheduledTaskInfo {
  const task = objectRecord(value, "scheduled task")
  validateRequiredString(
    task.id,
    "Invalid scheduled task response: id is required",
  )
  validateRequiredString(
    task.name,
    "Invalid scheduled task response: name is required",
  )
  validateRequiredString(
    task.description,
    "Invalid scheduled task response: description is required",
  )
  task.triggers = validateArray(
    task.triggers,
    "Invalid scheduled task response: triggers must be an array",
  ).map(validateScheduledTaskTrigger)
  validateEnumString(
    task.state,
    SCHEDULED_TASK_STATE,
    "Invalid scheduled task response: state is invalid",
  )
  validateNullableEnumString(
    task.currentTrigger,
    SCHEDULED_TASK_RUN_TRIGGER,
    "Invalid scheduled task response: currentTrigger is invalid",
  )
  validateNullableDateString(
    task.lastStartedAt,
    "Invalid scheduled task response: lastStartedAt must be an ISO date or null",
  )
  validateNullableDateString(
    task.lastFinishedAt,
    "Invalid scheduled task response: lastFinishedAt must be an ISO date or null",
  )
  validateNullableNonNegativeInteger(
    task.lastDurationMs,
    "Invalid scheduled task response: lastDurationMs must be non-negative or null",
  )
  validateNullableEnumString(
    task.lastStatus,
    SCHEDULED_TASK_STATUS,
    "Invalid scheduled task response: lastStatus is invalid",
  )
  validateNullableString(
    task.lastError,
    "Invalid scheduled task response: lastError must be string or null",
  )
  validateScheduledTaskResult(task.lastResult)
  return value as AdminScheduledTaskInfo
}

export function validateAdminScheduledTaskRunResponse(
  value: unknown,
): AdminScheduledTaskRunResponse {
  const response = objectRecord(value, "scheduled task run")
  validateBoolean(
    response.started,
    "Invalid scheduled task run response: started must be boolean",
  )
  validateBoolean(
    response.queued,
    "Invalid scheduled task run response: queued must be boolean",
  )
  response.task = validateAdminScheduledTaskInfo(response.task)
  return value as AdminScheduledTaskRunResponse
}

function validateScheduledTaskTrigger(value: unknown) {
  const trigger = objectRecord(value, "scheduled task trigger")
  validateEnumString(
    trigger.type,
    new Set(["startup", "cron"]),
    "Invalid scheduled task trigger response: type is invalid",
  )
  if (trigger.delayMs !== undefined) {
    validateNonNegativeInteger(
      trigger.delayMs,
      "Invalid scheduled task trigger response: delayMs must be non-negative",
    )
  }
  if (trigger.type === "cron") {
    validateRequiredString(
      trigger.expression,
      "Invalid scheduled task trigger response: expression is required",
    )
  }
  return value
}

function validateScheduledTaskResult(value: unknown): void {
  if (value === null) return
  const result = objectRecord(value, "scheduled task result")
  for (const [key, item] of Object.entries(result)) {
    if (!key.trim()) {
      throw new Error("Invalid scheduled task response: result key is empty")
    }
    if (
      item !== null &&
      typeof item !== "boolean" &&
      typeof item !== "number" &&
      typeof item !== "string"
    ) {
      throw new Error(
        "Invalid scheduled task response: result value is invalid",
      )
    }
  }
}

export function validateAdminReEncodeResponse(value: unknown): {
  enqueued: number
  hasMore: boolean
} {
  return validateBatchProgress(value, "re-encode", "enqueued")
}
