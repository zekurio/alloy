import type { StorageDeletionNamespace } from "@alloy/db/schema"

import type { StorageDriver } from "./driver"

export interface StorageDeletionRunInput {
  namespace: StorageDeletionNamespace
  key: string
  abortUpload: boolean
  sourceType: string
  sourceId: string | null
}

export interface StorageDeletionRunDependencies {
  storage: StorageDriver
  isWriteActive(namespace: StorageDeletionNamespace, key: string): boolean
  hasLiveReference(
    namespace: StorageDeletionNamespace,
    key: string,
    source: { type: string; id: string | null },
  ): Promise<boolean>
  signal: AbortSignal
}

export type StorageDeletionRunResult =
  | "adopted"
  | "deleted"
  | "referenced"
  | "interrupted"

/**
 * Execute one idempotent physical deletion. Database state transitions stay in
 * the coordinator so a process crash after delete but before commit simply
 * retries the missing-object success path.
 */
export async function runStorageDeletion(
  input: StorageDeletionRunInput,
  dependencies: StorageDeletionRunDependencies,
): Promise<StorageDeletionRunResult> {
  if (dependencies.signal.aborted) return "interrupted"

  // A durable prewrite reservation deliberately exists before its object is
  // attached to a row. Keep this process-local fence distinct from the DB
  // reference check: an active writer must always defer, while a later live
  // DB reference means that a prewrite reservation was successfully adopted.
  if (dependencies.isWriteActive(input.namespace, input.key)) {
    return "referenced"
  }
  if (
    await dependencies.hasLiveReference(input.namespace, input.key, {
      type: input.sourceType,
      id: input.sourceId,
    })
  ) {
    return input.sourceType === "storage-prewrite" ? "adopted" : "referenced"
  }
  if (dependencies.signal.aborted) return "interrupted"

  if (input.abortUpload) {
    await dependencies.storage.abortUpload({ key: input.key })
    // The abort is independently idempotent. If shutdown arrived while it was
    // running, leave the row for startup recovery rather than begin a delete.
    if (dependencies.signal.aborted) return "interrupted"
  }
  await dependencies.storage.delete(input.key)
  return "deleted"
}
