import type { StorageDeletionNamespace } from "@alloy/db/schema"

const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 60 * 60 * 1000
export const LIVE_REFERENCE_RECHECK_MS = 5 * 60 * 1000

export interface StorageDeletionInput {
  namespace: StorageDeletionNamespace
  key: string
  abortUpload?: boolean
  reason: string
  source: {
    type: string
    id?: string | null
  }
}

export interface ValidatedStorageDeletionInput {
  namespace: StorageDeletionNamespace
  key: string
  abortUpload: boolean
  reason: string
  sourceType: string
  sourceId: string | null
}

/** Indefinite exponential retry with a one-hour ceiling. */
export function storageDeletionRetryAt(
  previousAttempts: number,
  attemptedAt: Date,
): Date {
  const exponent = Math.min(Math.max(0, previousAttempts), 10)
  const delayMs = Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS)
  return new Date(attemptedAt.getTime() + delayMs)
}

export function validateStorageDeletionInput(
  input: StorageDeletionInput,
): ValidatedStorageDeletionInput {
  validateStorageKey(input.key)
  return {
    namespace: input.namespace,
    key: input.key,
    abortUpload: input.abortUpload ?? false,
    reason: boundedLabel(input.reason, "Deletion reason", 500),
    sourceType: boundedLabel(input.source.type, "Deletion source type", 100),
    sourceId:
      input.source.id === undefined || input.source.id === null
        ? null
        : boundedLabel(input.source.id, "Deletion source id", 500),
  }
}

/**
 * Require one canonical, relative object key. Rejecting aliases such as
 * `a/../b` is important because namespace+key is the deduplication identity.
 */
export function validateStorageKey(key: string): void {
  if (key.length === 0 || key.length > 2048) {
    throw new Error(
      "Storage deletion key must be between 1 and 2048 characters",
    )
  }
  if (
    key.includes("\\") ||
    key.includes("\0") ||
    key.includes("?") ||
    key.includes("#")
  ) {
    throw new Error("Storage deletion key must use safe forward-slash segments")
  }
  const segments = key.split("/")
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error("Storage deletion key must be a canonical relative path")
  }
}

function boundedLabel(value: string, label: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new Error(`${label} must be between 1 and ${max} characters`)
  }
  return trimmed
}
