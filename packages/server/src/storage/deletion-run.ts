import type { StorageDeletionNamespace } from "@alloy/db/schema"
import {
  thumbnailVariantBase,
  thumbnailVariantKeys,
} from "@alloy/server/media/thumbnail-variants"

import { storageDeletionReference } from "./deletion-references"
import type { FsStorageDriver } from "./fs-driver"
import { assetStorage, clipStorage, clipThumbnailStorage } from "./index"
import { storageObjectWriteIsActive } from "./write-activity"

export interface StorageDeletionRunInput {
  namespace: StorageDeletionNamespace
  key: string
  abortUpload: boolean
  sourceType: string
  sourceId: string | null
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
  signal: AbortSignal,
): Promise<StorageDeletionRunResult> {
  if (signal.aborted) return "interrupted"

  // A durable prewrite reservation deliberately exists before its object is
  // attached to a row. Keep this process-local fence distinct from the DB
  // reference check: an active writer must always defer, while a later row
  // reference means that a prewrite reservation was successfully adopted. A
  // media run that holds the object's clip may still attach it, so its
  // reservation waits for the run like any other deletion.
  if (isWriteActive(input.namespace, input.key)) return "referenced"
  const reference = await storageDeletionReference(input.namespace, input.key, {
    type: input.sourceType,
    id: input.sourceId,
  })
  if (reference === "row" && input.sourceType === "storage-prewrite") {
    return "adopted"
  }
  if (reference) return "referenced"
  if (signal.aborted) return "interrupted"

  const storage = storageDriver(input.namespace)
  if (input.abortUpload) {
    await storage.abortUpload({ key: input.key })
    // The abort is independently idempotent. If shutdown arrived while it was
    // running, leave the row for startup recovery rather than begin a delete.
    if (signal.aborted) return "interrupted"
  }
  // Derived objects go first: a retry after a crash in between still finds
  // the key that names them. A thumbnail's variants exist only for it.
  if (input.namespace === "thumbnails") {
    for (const key of thumbnailVariantKeys(input.key)) {
      await storage.delete(key)
    }
  }
  await storage.delete(input.key)
  return "deleted"
}

/**
 * A thumbnail's variants are written under the thumbnail's own reservation
 * and fence, so a variant waits on writes to its thumbnail too.
 */
function isWriteActive(namespace: StorageDeletionNamespace, key: string) {
  const thumbKey = namespace === "thumbnails" ? thumbnailVariantBase(key) : null
  return (
    storageObjectWriteIsActive(namespace, key) ||
    (thumbKey !== null && storageObjectWriteIsActive(namespace, thumbKey))
  )
}

function storageDriver(namespace: StorageDeletionNamespace): FsStorageDriver {
  switch (namespace) {
    case "clips":
      return clipStorage
    case "thumbnails":
      return clipThumbnailStorage
    case "assets":
      return assetStorage
  }
}
