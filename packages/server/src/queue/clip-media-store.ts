import type { EncodeStage } from "@alloy/contracts"
// Clip-row writes for the media pipeline. Every write is guarded by the
// encode runId and returns false/null once the run has moved on
// (stale-takeover safe).
import { clip, clipRendition } from "@alloy/db/schema"
import { publishClipUpsertById } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { mediaAssetDeletionIntents } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { deleteUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import { and, eq, lt, sql } from "drizzle-orm"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"

import {
  clearedStageColumns,
  completeRequestColumns,
  publishedAtStamp,
  sourcePatchToColumns,
  thumbPatchToColumns,
} from "./clip-media-store-columns"
import type {
  MediaCompletion,
  MediaSourcePatch,
  MediaStageTier,
  MediaThumbPatch,
} from "./media-store"

// Ready rows stay ready across a reprocess run so `stream` access (which is
// gated on status = 'ready') keeps serving the committed assets meanwhile.
const keepReadyStatus = sql`case when ${clip.status} = 'ready' then 'ready' else 'processing' end`

function finishedAssetLeaseColumns(
  completion: MediaCompletion,
  patch: { thumb_failed_at?: Date } = {},
) {
  return {
    ...clearedStageColumns,
    ...completeRequestColumns(completion),
    ...patch,
    encode_generation: completion.targetGeneration,
    encode_failed_generation: null,
    encode_progress: 100,
    encode_run_id: null,
    encode_locked_at: null,
    failure_reason: null,
    updated_at: new Date(),
  }
}

const assetKeyColumns = {
  sourceKey: clip.source_key,
  waveformKey: clip.waveform_key,
  cutKey: clip.cut_key,
  thumbKey: clip.thumb_key,
}

/**
 * Lock the clip row the run still owns, apply `columns`, and queue deletion
 * of the `replaced` assets that `retainedKeys` no longer reference, all in
 * one transaction. `alsoQueue` adds deletions of its own and returns their
 * count. Returns false when the run lost the row.
 */
async function commitAssetReplacement(
  id: string,
  runId: string,
  replacement: {
    columns: PgUpdateSetSource<typeof clip>
    replaced: (keyof typeof assetKeyColumns)[]
    retainedKeys: (string | null)[]
    reason: string
    alsoQueue?: (tx: DbTransaction) => Promise<number>
  },
): Promise<boolean> {
  const ownedByRun = and(eq(clip.id, id), eq(clip.encode_run_id, runId))
  const queuedDeletions = await db.transaction(async (tx) => {
    const [current] = await tx
      .select(assetKeyColumns)
      .from(clip)
      .where(ownedByRun)
      .limit(1)
      .for("update")
    if (!current) return null

    const [updated] = await tx
      .update(clip)
      .set(replacement.columns)
      .where(ownedByRun)
      .returning({ id: clip.id })
    if (!updated) return null

    const intents = mediaAssetDeletionIntents({
      keys: replacement.replaced.map((name) => current[name]),
      retainedKeys: replacement.retainedKeys,
      reason: replacement.reason,
      source: { type: "media-run", id: runId },
    })
    await enqueueStorageDeletions(intents, { tx })
    return intents.length + ((await replacement.alsoQueue?.(tx)) ?? 0)
  })
  if (queuedDeletions === null) return false
  if (queuedDeletions > 0) wakeStorageDeletionWorker()
  return true
}

/** True while the row still holds this run's lease. */
export async function runStillPresent(
  id: string,
  runId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
    .limit(1)
  return Boolean(row)
}

/** Reset progress at the start of the run body; false if lease lost. */
export async function beginProcessing(
  id: string,
  runId: string,
): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set({
      status: keepReadyStatus,
      encode_progress: 0,
      failure_reason: null,
      updated_at: new Date(),
    })
    .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
    .returning({ id: clip.id })
  return Boolean(row)
}

/** Persist active encode stage labels, guarded by runId. */
export async function commitStage(
  id: string,
  runId: string,
  stage: EncodeStage,
  tier?: MediaStageTier,
): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set({
      encode_stage: stage,
      encode_tier: tier?.name ?? null,
      encode_tier_index: tier?.index ?? null,
      encode_tier_count: tier?.count ?? null,
      updated_at: new Date(),
    })
    .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
    .returning({ id: clip.id })
  if (!row) return false
  void publishClipUpsertById(id)
  return true
}

/** Persist a progress %, guarded by runId; true if the row advanced. */
export async function commitProgress(
  id: string,
  runId: string,
  pct: number,
): Promise<boolean> {
  const rows = await db
    .update(clip)
    .set({ encode_progress: pct, updated_at: new Date() })
    .where(
      and(
        eq(clip.id, id),
        eq(clip.encode_run_id, runId),
        lt(clip.encode_progress, pct),
      ),
    )
    .returning({ id: clip.id })
  return rows.length > 0
}

/** Commit source facts plus the current materialized cut reference. */
export async function commitSource(
  id: string,
  runId: string,
  patch: MediaSourcePatch,
): Promise<boolean> {
  return withUploadActivityStopped(id, () =>
    commitAssetReplacement(id, runId, {
      columns: { ...sourcePatchToColumns(patch), updated_at: new Date() },
      replaced: ["sourceKey", "waveformKey", "cutKey"],
      retainedKeys: [patch.sourceKey, patch.waveformKey, patch.cutKey],
      reason: "media source replaced",
      alsoQueue: (tx) =>
        deleteUploadTicketsWithStorageIntents(id, "media source committed", tx),
    }),
  )
}

/** Commit the poster; false if lease lost. */
export async function commitThumb(
  id: string,
  runId: string,
  patch: MediaThumbPatch,
): Promise<boolean> {
  return commitAssetReplacement(id, runId, {
    columns: { ...thumbPatchToColumns(patch), updated_at: new Date() },
    replaced: ["thumbKey"],
    retainedKeys: [patch.thumbKey],
    reason: "media thumbnail replaced",
  })
}

/** Clear a thumbnail-only run after success. */
export async function finishThumbnailBackfill(
  id: string,
  runId: string,
  completion: MediaCompletion,
): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set(finishedAssetLeaseColumns(completion))
    .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
    .returning({ id: clip.id })
  return Boolean(row)
}

/** Mark content as permanently unsuitable for poster extraction. */
export async function commitThumbFailed(
  id: string,
  runId: string,
  completion: MediaCompletion,
): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set(
      finishedAssetLeaseColumns(completion, {
        thumb_failed_at: new Date(),
      }),
    )
    .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
    .returning({ id: clip.id })
  return Boolean(row)
}

/**
 * Transitions the row to publicly playable once source and thumbnail state
 * are committed, while the encode ladder continues under the same lease.
 * This is the eager-release moment: when the clip is public it also stamps
 * `published_at` (write-once) since the clip is now feed-visible. Does not
 * touch encode_progress; only commitClipMediaReady owns the full encode
 * result.
 */
export async function commitPlayable(
  id: string,
  runId: string,
): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set({
      status: "ready",
      published_at: publishedAtStamp,
      updated_at: new Date(),
    })
    .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
    .returning({ id: clip.id })
  // commitClipMediaReady announces after the OG rendition is publicly
  // reachable.
  return Boolean(row)
}

/** Current asset keys, so a failing run never deletes live assets. */
export async function currentAssetKeys(id: string): Promise<{
  sourceKey: string | null
  waveformKey: string | null
  cutKey: string | null
  thumbKey: string | null
  renditionKeys: string[]
} | null> {
  const [row] = await db
    .select({
      sourceKey: clip.source_key,
      waveformKey: clip.waveform_key,
      cutKey: clip.cut_key,
      thumbKey: clip.thumb_key,
    })
    .from(clip)
    .where(eq(clip.id, id))
    .limit(1)
  if (!row) return null
  const renditionRows = await db
    .select({ storageKey: clipRendition.storage_key })
    .from(clipRendition)
    .where(eq(clipRendition.clip_id, id))
  return {
    ...row,
    renditionKeys: renditionRows.map((rendition) => rendition.storageKey),
  }
}
