import type {
  AdminRuntimeConfig,
  ClipRow,
  FeedPage,
  NotificationsResponse,
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
