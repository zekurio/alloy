import { clip, clipRendition } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { mediaAssetDeletionIntents } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import {
  selectLockedQuotaState,
  uploadWouldExceedQuota,
} from "@alloy/server/storage/quota"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { deleteUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import {
  claimClipPublishedDeliveries,
  wakeClaimedClipPublishedDeliveries,
} from "@alloy/server/webhooks/publish"
import { and, eq } from "drizzle-orm"

import {
  clearedStageColumns,
  completeRequestColumns,
  publishedAtStamp,
  sourcePatchToColumns,
  thumbPatchToColumns,
} from "./clip-media-store-columns"
import type {
  MediaCompletion,
  MediaRenditionRecord,
  MediaSourcePatch,
  MediaThumbPatch,
} from "./media-store"

type ReadyCurrent = {
  sourceKey: string | null
  sourceSizeBytes: number | null
  waveformKey: string | null
  cutKey: string | null
  thumbKey: string | null
}

type ReadyCommitResult = {
  committed: boolean
  webhookClaims: number
  queuedDeletions: number
}

const noReadyCommit = (): ReadyCommitResult => ({
  committed: false,
  webhookClaims: 0,
  queuedDeletions: 0,
})

async function selectReadyCurrent(
  tx: DbTransaction,
  id: string,
  runId: string,
): Promise<ReadyCurrent | null> {
  const [current] = await tx
    .select({
      sourceKey: clip.source_key,
      sourceSizeBytes: clip.source_size_bytes,
      waveformKey: clip.waveform_key,
      cutKey: clip.cut_key,
      thumbKey: clip.thumb_key,
    })
    .from(clip)
    .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
    .limit(1)
    .for("update")
  return current ?? null
}

async function selectReadyQuota(
  tx: DbTransaction,
  id: string,
  patch: MediaSourcePatch,
): Promise<Awaited<ReturnType<typeof selectLockedQuotaState>> | null> {
  if (!patch.sourceContentType.startsWith("image/")) return null
  const [owner] = await tx
    .select({ id: clip.author_id })
    .from(clip)
    .where(eq(clip.id, id))
    .limit(1)
  return owner ? selectLockedQuotaState(tx, owner.id) : null
}

function enforceReadyQuota(
  quota: Awaited<ReturnType<typeof selectLockedQuotaState>> | null,
  patch: MediaSourcePatch,
  current: ReadyCurrent,
): void {
  if (
    quota?.quotaBytes != null &&
    uploadWouldExceedQuota({
      ...quota,
      quotaBytes: quota.quotaBytes,
      reservedBytes: current.sourceSizeBytes ?? 0,
      incomingBytes: patch.sourceSizeBytes,
    })
  )
    throw new Error("Processed screenshot exceeds storage quota")
}

async function markClipReady(
  tx: DbTransaction,
  id: string,
  runId: string,
  patch: MediaSourcePatch & MediaThumbPatch & { encodeFingerprint: string },
  completion: MediaCompletion,
): Promise<boolean> {
  const [updated] = await tx
    .update(clip)
    .set({
      ...sourcePatchToColumns(patch),
      ...thumbPatchToColumns(patch),
      ...clearedStageColumns,
      status: "ready",
      published_at: publishedAtStamp,
      encode_fingerprint: patch.encodeFingerprint,
      encode_failed_fingerprint: null,
      encode_generation: completion.targetGeneration,
      encode_failed_generation: null,
      encode_progress: 100,
      ...completeRequestColumns(completion),
      encode_run_id: null,
      encode_locked_at: null,
      failure_reason: null,
      updated_at: new Date(),
    })
    .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
    .returning({ id: clip.id })
  return Boolean(updated)
}

async function replaceRenditions(
  tx: DbTransaction,
  id: string,
  renditions: readonly MediaRenditionRecord[],
): Promise<void> {
  await tx.delete(clipRendition).where(eq(clipRendition.clip_id, id))
  if (renditions.length === 0) return
  await tx.insert(clipRendition).values(
    renditions.map((rendition) => ({
      clip_id: id,
      name: rendition.name,
      is_og: rendition.isOg,
      height: rendition.height,
      width: rendition.width,
      fps: rendition.fps,
      storage_key: rendition.storageKey,
      codecs: rendition.codecs,
      size_bytes: rendition.sizeBytes,
    })),
  )
}

async function commitReadyTransaction(
  tx: DbTransaction,
  id: string,
  runId: string,
  patch: MediaSourcePatch &
    MediaThumbPatch & {
      encodeFingerprint: string
    },
  renditions: readonly MediaRenditionRecord[],
  completion: MediaCompletion,
): Promise<ReadyCommitResult> {
  const quota = await selectReadyQuota(tx, id, patch)
  const current = await selectReadyCurrent(tx, id, runId)
  if (!current) return noReadyCommit()
  enforceReadyQuota(quota, patch, current)
  const previousRenditions = await tx
    .select({ storageKey: clipRendition.storage_key })
    .from(clipRendition)
    .where(eq(clipRendition.clip_id, id))
  if (!(await markClipReady(tx, id, runId, patch, completion))) {
    return noReadyCommit()
  }
  const mediaIntents = mediaAssetDeletionIntents({
    keys: [
      current.sourceKey,
      current.waveformKey,
      current.cutKey,
      current.thumbKey,
      ...previousRenditions.map((row) => row.storageKey),
    ],
    retainedKeys: [
      patch.sourceKey,
      patch.waveformKey,
      patch.cutKey,
      patch.thumbKey,
      ...renditions.map((row) => row.storageKey),
    ],
    reason: "media output replaced",
    source: { type: "media-run", id: runId },
  })
  await enqueueStorageDeletions(mediaIntents, { tx })
  await replaceRenditions(tx, id, renditions)
  const stagedIntents = await deleteUploadTicketsWithStorageIntents(
    { type: "clip", id },
    "media source committed",
    tx,
  )
  return {
    committed: true,
    webhookClaims: await claimClipPublishedDeliveries(tx, id),
    queuedDeletions: mediaIntents.length + stagedIntents,
  }
}

export async function commitClipMediaReady(
  id: string,
  runId: string,
  patch: MediaSourcePatch &
    MediaThumbPatch & {
      encodeFingerprint: string
    },
  renditions: readonly MediaRenditionRecord[],
  completion: MediaCompletion,
): Promise<boolean> {
  const result = await withUploadActivityStopped(id, () =>
    db.transaction((tx) =>
      commitReadyTransaction(tx, id, runId, patch, renditions, completion),
    ),
  )
  if (result.queuedDeletions > 0) wakeStorageDeletionWorker()
  wakeClaimedClipPublishedDeliveries(result.webhookClaims)
  return result.committed
}
