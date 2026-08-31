import type { StorageDeletionInput } from "@alloy/server/storage/deletion-policy"
import { clipAssetKey } from "@alloy/server/storage/driver"

import { clipKeyDeletionNamespace } from "./clip-key"

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

export function prewriteAssetDeletionIntent(input: {
  key: string
  attemptId: string
  reason?: string
}): StorageDeletionInput {
  return {
    namespace: "assets",
    key: input.key,
    reason: input.reason ?? "pending asset upload",
    source: { type: "storage-prewrite", id: input.attemptId },
  }
}

export function mediaAssetDeletionIntents(input: {
  keys: Iterable<string | null>
  retainedKeys?: Iterable<string | null>
  reason: string
  source: { type: string; id?: string | null }
}): StorageDeletionInput[] {
  const retained = new Set(
    [...(input.retainedKeys ?? [])]
      .filter((key): key is string => key !== null)
      .map((key) => key.toLowerCase()),
  )
  const intents: StorageDeletionInput[] = []
  for (const key of input.keys) {
    if (!key || retained.has(key.toLowerCase())) continue
    intents.push({
      namespace: clipKeyDeletionNamespace(key),
      key,
      reason: input.reason,
      source: input.source,
    })
  }
  return deduplicateDeletionIntents(intents)
}

export function posterDeletionIntents(input: {
  previousKey: string | null
  uploadedKey: string
  accepted: boolean
  attemptId: string
}): StorageDeletionInput[] {
  return mediaAssetDeletionIntents({
    keys: [input.accepted ? input.previousKey : input.uploadedKey],
    retainedKeys: input.accepted ? [input.uploadedKey] : [],
    reason: input.accepted ? "poster replaced" : "poster update rejected",
    source: { type: "poster-request", id: input.attemptId },
  })
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
