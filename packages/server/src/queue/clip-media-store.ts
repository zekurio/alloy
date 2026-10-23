import { clip, clipRendition } from "@alloy/db/schema"
import {
  publishClipProgress,
  publishClipUpsert,
  publishClipUpsertById,
} from "@alloy/server/clips/events"
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
import { commitClipMediaReady } from "./clip-media-store-ready"
import type {
  MediaCompletion,
  MediaSourcePatch,
  MediaStore,
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

export const clipMediaStore: MediaStore = {
  target: "clip",

  async stillPresent(id, runId) {
    const [row] = await db
      .select({ id: clip.id })
      .from(clip)
      .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
      .limit(1)
    return Boolean(row)
  },

  async beginProcessing(id, runId) {
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
  },

  async commitStage(id, runId, stage, tier) {
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
  },

  async commitProgress(id, runId, pct) {
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
  },

  publishProgress(authorId, id, pct) {
    publishClipProgress(authorId, id, pct)
  },

  async commitSource(id, runId, patch: MediaSourcePatch) {
    return withUploadActivityStopped(id, () =>
      commitAssetReplacement(id, runId, {
        columns: { ...sourcePatchToColumns(patch), updated_at: new Date() },
        replaced: ["sourceKey", "waveformKey", "cutKey"],
        retainedKeys: [patch.sourceKey, patch.waveformKey, patch.cutKey],
        reason: "media source replaced",
        alsoQueue: (tx) =>
          deleteUploadTicketsWithStorageIntents(
            { type: "clip", id },
            "media source committed",
            tx,
          ),
      }),
    )
  },

  async commitThumb(id, runId, patch: MediaThumbPatch) {
    return commitAssetReplacement(id, runId, {
      columns: { ...thumbPatchToColumns(patch), updated_at: new Date() },
      replaced: ["thumbKey"],
      retainedKeys: [patch.thumbKey],
      reason: "media thumbnail replaced",
    })
  },

  async commitWaveform(id, runId, waveformKey, completion) {
    return commitAssetReplacement(id, runId, {
      columns: {
        ...finishedAssetLeaseColumns(completion),
        waveform_key: waveformKey,
      },
      replaced: ["waveformKey"],
      retainedKeys: [waveformKey],
      reason: "media waveform replaced",
    })
  },

  async finishThumbnailBackfill(id, runId, completion) {
    const [row] = await db
      .update(clip)
      .set(finishedAssetLeaseColumns(completion))
      .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
      .returning({ id: clip.id })
    return Boolean(row)
  },

  async commitThumbFailed(id, runId, completion) {
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
  },

  async commitPlayable(id, runId) {
    const [row] = await db
      .update(clip)
      .set({
        status: "ready",
        published_at: publishedAtStamp,
        updated_at: new Date(),
      })
      .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
      .returning({ id: clip.id })
    // commitReady announces after the OG rendition is publicly reachable.
    return Boolean(row)
  },

  async commitReady(id, runId, patch, renditions, completion) {
    return commitClipMediaReady(id, runId, patch, renditions, completion)
  },

  async currentAssetKeys(id) {
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
  },

  publishUpsert(authorId, id) {
    void publishClipUpsert(authorId, id)
  },
}
