import type {
  AdminRuntimeConfig,
  ClipLikeState,
  ClipRow,
  FeedPage,
  InitiateClipResponse,
  NotificationsResponse,
  QueueClip,
  SearchResults,
} from "@workspace/contracts"

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label} response`)
  }
  return value as Record<string, unknown>
}

function assertNoStorageKey(value: Record<string, unknown>, label: string) {
  if ("storageKey" in value) {
    throw new Error(`Invalid ${label} response: storageKey must not be public`)
  }
}

export function validateObject<T>(value: unknown, label: string): T {
  objectRecord(value, label)
  return value as T
}

export function validateObjectArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label} response`)
  for (const item of value) objectRecord(item, label)
  return value as T[]
}

export function validateClipRow(value: unknown): ClipRow {
  const row = objectRecord(value, "clip")
  assertNoStorageKey(row, "clip")
  if (!Array.isArray(row.variants)) {
    throw new Error("Invalid clip response: variants must be an array")
  }
  for (const variant of row.variants) {
    const variantRow = objectRecord(variant, "clip variant")
    assertNoStorageKey(variantRow, "clip variant")
  }
  return value as ClipRow
}

export function validateClipRows(value: unknown): ClipRow[] {
  if (!Array.isArray(value)) throw new Error("Invalid clips response")
  return value.map(validateClipRow)
}

export function validateQueueClips(value: unknown): QueueClip[] {
  if (!Array.isArray(value)) throw new Error("Invalid queue response")
  for (const item of value) {
    const row = objectRecord(item, "queue clip")
    if (typeof row.id !== "string") {
      throw new Error("Invalid queue response: id must be a string")
    }
    if (typeof row.status !== "string") {
      throw new Error("Invalid queue response: status must be a string")
    }
    if (typeof row.encodeProgress !== "number") {
      throw new Error("Invalid queue response: encodeProgress must be numeric")
    }
  }
  return value as QueueClip[]
}

export function validateInitiateClipResponse(
  value: unknown
): InitiateClipResponse {
  const response = objectRecord(value, "initiate clip")
  if (typeof response.clipId !== "string") {
    throw new Error("Invalid initiate clip response: clipId must be a string")
  }
  objectRecord(response.ticket, "upload ticket")
  return value as InitiateClipResponse
}

export function validateClipLikeState(value: unknown): ClipLikeState {
  const response = objectRecord(value, "clip like state")
  if (typeof response.liked !== "boolean") {
    throw new Error("Invalid clip like response: liked must be boolean")
  }
  if (typeof response.likeCount !== "number") {
    throw new Error("Invalid clip like response: likeCount must be numeric")
  }
  return value as ClipLikeState
}

export function validateBooleanFlag<T extends string, V extends boolean>(
  value: unknown,
  key: T,
  expected?: V
): Record<T, V extends boolean ? V : boolean> {
  const response = objectRecord(value, key)
  if (
    (expected === undefined &&
      response[key] !== true &&
      response[key] !== false) ||
    (expected !== undefined && response[key] !== expected)
  ) {
    throw new Error(`Invalid ${key} response: ${key} must be boolean`)
  }
  return response as Record<T, V extends boolean ? V : boolean>
}

export function validateFeedPage(value: unknown): FeedPage {
  const page = objectRecord(value, "feed")
  if (!Array.isArray(page.items)) {
    throw new Error("Invalid feed response: items must be an array")
  }
  page.items.map(validateClipRow)
  return value as FeedPage
}

export function validateSearchResults(value: unknown): SearchResults {
  const results = objectRecord(value, "search")
  if (!Array.isArray(results.clips)) {
    throw new Error("Invalid search response: clips must be an array")
  }
  results.clips.map(validateClipRow)
  return value as SearchResults
}

export function validateNotificationsResponse(
  value: unknown
): NotificationsResponse {
  const response = objectRecord(value, "notifications")
  if (!Array.isArray(response.items)) {
    throw new Error("Invalid notifications response: items must be an array")
  }
  if (typeof response.unreadCount !== "number") {
    throw new Error(
      "Invalid notifications response: unreadCount must be numeric"
    )
  }
  return value as NotificationsResponse
}

export function validateAdminRuntimeConfig(value: unknown): AdminRuntimeConfig {
  const config = objectRecord(value, "admin runtime config")
  objectRecord(config.limits, "admin limits config")
  objectRecord(config.encoder, "admin encoder config")
  return value as AdminRuntimeConfig
}
