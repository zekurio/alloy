import type { StorageDeletionInput } from "@alloy/server/storage/deletion-policy"
import { clipAssetKey } from "@alloy/server/storage/driver"

export interface ClipStorageDeletionSnapshot {
  clipId: string
  sourceKey: string | null
  cutKey: string | null
  thumbKey: string | null
  renditionKeys: readonly string[]
  audioTrackKeys: readonly string[]
}

/**
 * Classify every object whose ownership disappears with a clip row. Keeping
 * this pure makes the transaction boundary easy to test independently from
 * PostgreSQL and the physical storage driver.
 */
export function clipStorageDeletionIntents(
  snapshot: ClipStorageDeletionSnapshot,
): StorageDeletionInput[] {
  const clipId = snapshot.clipId.toLowerCase()
  const source = { type: "clip", id: clipId }
  const intents: StorageDeletionInput[] = []

  for (const key of [
    snapshot.sourceKey,
    snapshot.cutKey,
    ...snapshot.renditionKeys,
    ...snapshot.audioTrackKeys,
  ]) {
    if (!key) continue
    intents.push({
      namespace: "clips",
      key,
      reason: "clip deleted",
      source,
    })
  }

  // The stable names predate thumb_key. They remain protected as live while a
  // clip exists, so deleting the owner is the one exact moment we can safely
  // retire them even when no current row points at them.
  for (const key of [
    snapshot.thumbKey,
    clipAssetKey(clipId, "thumb"),
    clipAssetKey(clipId, "thumb-small"),
  ]) {
    if (!key) continue
    intents.push({
      namespace: "thumbnails",
      key,
      reason: "clip deleted",
      source,
    })
  }

  return deduplicateDeletionIntents(intents)
}

export function stagedUploadDeletionIntent(input: {
  key: string
  reason: string
  source: { type: string; id?: string | null }
}): StorageDeletionInput {
  return {
    namespace: "clips",
    key: input.key,
    abortUpload: true,
    reason: input.reason,
    source: input.source,
  }
}

function deduplicateDeletionIntents(
  intents: readonly StorageDeletionInput[],
): StorageDeletionInput[] {
  const unique = new Map<string, StorageDeletionInput>()
  for (const intent of intents) {
    unique.set(`${intent.namespace}\0${intent.key}`, intent)
  }
  return [...unique.values()]
}
