import {
  objectRecord,
  validateArray,
  validateNonNegativeInteger,
  validateNonNegativeNumber,
  validateNullablePositiveInteger,
  validateNullableRequiredString,
  validateNullableUrlString,
  validateRequiredString,
} from "@alloy/api/runtime-validation"
import {
  type FeedChipGame,
  type FeedChipsResponse,
  type FeedPage,
  type SearchResults,
} from "@alloy/contracts"

import { validateClipRow } from "./clips"
import { validateGameListRow } from "./games-media"
import { validateUserListRow } from "./people"
export function validateFeedPage(value: unknown): FeedPage {
  const page = objectRecord(value, "feed")
  validateArray(
    page.items,
    "Invalid feed response: items must be an array",
  ).map(validateClipRow)
  validateNullableRequiredString(
    page.nextCursor,
    "Invalid feed response: nextCursor must be a non-empty string or null",
  )
  return value as FeedPage
}

function validateFeedChipGame(value: unknown): FeedChipGame {
  const row = objectRecord(value, "feed chip game")
  validateRequiredString(row.id, "Invalid feed chips response: id is required")
  validateNullablePositiveInteger(
    row.steamgriddbId,
    "Invalid feed chips response: steamgriddbId must be a positive integer or null",
  )
  for (const key of ["slug", "name"] as const) {
    validateRequiredString(
      row[key],
      `Invalid feed chips response: ${key} is required`,
    )
  }
  for (const key of ["iconUrl", "logoUrl"] as const) {
    validateNullableUrlString(
      row[key],
      `Invalid feed chips response: ${key} must be a URL or null`,
    )
  }
  validateNonNegativeNumber(
    row.interaction,
    "Invalid feed chips response: interaction must be numeric",
  )
  validateNonNegativeInteger(
    row.clipCount,
    "Invalid feed chips response: clipCount must be a non-negative integer",
  )
  return value as FeedChipGame
}

export function validateFeedChipsResponse(value: unknown): FeedChipsResponse {
  const response = objectRecord(value, "feed chips")
  validateArray(
    response.games,
    "Invalid feed chips response: games must be an array",
  ).map(validateFeedChipGame)
  return value as FeedChipsResponse
}

export function validateSearchResults(value: unknown): SearchResults {
  const results = objectRecord(value, "search")
  validateArray(
    results.clips,
    "Invalid search response: clips must be an array",
  ).map(validateClipRow)
  validateArray(
    results.games,
    "Invalid search response: games must be an array",
  ).map(validateGameListRow)
  validateArray(
    results.users,
    "Invalid search response: users must be an array",
  ).map(validateUserListRow)
  return value as SearchResults
}
