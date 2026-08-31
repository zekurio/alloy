import type { StorageDeletionNamespace } from "@alloy/db/schema"

import { runStorageDeletion } from "./deletion-run"
import type { StorageDriver } from "./driver"

export interface StorageGcCandidateDeletionDependencies {
  storage: StorageDriver
  classifyCurrent(): Promise<boolean>
  isWriteActive(namespace: StorageDeletionNamespace, key: string): boolean
  hasLiveReference(
    namespace: StorageDeletionNamespace,
    key: string,
    source: { type: string; id: string | null },
  ): Promise<boolean>
  signal: AbortSignal
}

export type StorageGcCandidateDeletionResult =
  | "deleted"
  | "interrupted"
  | "protected"
  | "reclassified"

/**
 * Revalidate a previewed candidate and apply the shared last-mile guards.
 * GC admits only >48h parsed keys. Publishers mint immutable run-stamped keys,
 * while the caller reclassifies legacy thumbnails against current clip state.
 * These checks do not serialize a later stable-key adopter; keep this sweep
 * operator-confirmed until extraction adds shared mutation ownership.
 */
export async function deleteStorageGcCandidate(
  namespace: StorageDeletionNamespace,
  key: string,
  dependencies: StorageGcCandidateDeletionDependencies,
): Promise<StorageGcCandidateDeletionResult> {
  if (dependencies.signal.aborted) return "interrupted"
  if (!(await dependencies.classifyCurrent())) return "reclassified"
  const result = await runStorageDeletion(
    {
      namespace,
      key,
      abortUpload: false,
      sourceType: "storage-gc",
      sourceId: null,
    },
    dependencies,
  )
  return result === "referenced" || result === "adopted" ? "protected" : result
}
