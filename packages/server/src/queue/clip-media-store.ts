import { clip, clipAudioTrack, clipRendition } from "@alloy/db/schema"
import {
  publishClipProgress,
  publishClipUpsert,
  publishClipUpsertById,
} from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { mediaAssetDeletionIntents } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { deleteUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import {
  claimClipPublishedDeliveries,
  wakeClaimedClipPublishedDeliveries,
} from "@alloy/server/webhooks/publish"
import { and, eq, lt, sql } from "drizzle-orm"

import type {
  MediaCompletion,
  MediaSourcePatch,
  MediaStore,
  MediaThumbPatch,
} from "./media-store"

// Ready rows stay ready across a reprocess run so `stream` access (which is
// gated on status = 'ready') keeps serving the committed assets meanwhile.
const keepReadyStatus = sql`case when ${clip.status} = 'ready' then 'ready' else 'processing' end`

export const clearedStageColumns = {
  encode_stage: null,
  encode_tier: null,
  encode_tier_index: null,
  encode_tier_count: null,
}

// Write-once publish stamp: only public rows get one, and the first transition
// to (ready + public) wins so a privacy round-trip can't bump feed position.
const publishedAtStamp = sql`coalesce(${clip.published_at}, case when ${clip.privacy} = 'public' then now() end)`

function sourcePatchToColumns(patch: MediaSourcePatch) {
  return {
    source_key: patch.sourceKey,
    source_content_type: patch.sourceContentType,
    source_video_codec: patch.sourceVideoCodec,
    source_audio_codec: patch.sourceAudioCodec,
    source_codecs: patch.sourceCodecs,
    source_fps: patch.sourceFps,
    source_size_bytes: patch.sourceSizeBytes,
    source_duration_ms: patch.sourceDurationMs,
    waveform_key: patch.waveformKey,
    pending_audio_tracks: patch.pendingAudioTracks,
    audio_track_fingerprint: patch.audioTrackFingerprint,
    cut_key: patch.cutKey,
    cut_codecs: patch.cutCodecs,
    duration_ms: patch.durationMs,
    width: patch.width,
    height: patch.height,
    thumb_failed_at: null,
  }
}

function thumbPatchToColumns(patch: MediaThumbPatch) {
  const columns = {
    thumb_key: patch.thumbKey,
    thumb_blur_hash: patch.thumbBlurHash,
  }
  if (patch.thumbFailedAt === undefined && patch.thumbKey) {
    return { ...columns, thumb_failed_at: null }
  }
  if (patch.thumbFailedAt === undefined) return columns
  return { ...columns, thumb_failed_at: patch.thumbFailedAt }
}

export function completeRequestColumns(completion: MediaCompletion) {
  const ownsRequest = sql`${clip.encode_request_id} = ${completion.requestId}`
  return {
    encode_request_id: sql`case when ${ownsRequest} then null else ${clip.encode_request_id} end`,
    encode_request_force: sql`case when ${ownsRequest} then false else ${clip.encode_request_force} end`,
    encode_requested_at: sql`case when ${ownsRequest} then null else ${clip.encode_requested_at} end`,
    encode_run_after: sql`case when ${ownsRequest} then null else ${clip.encode_run_after} end`,
    encode_priority: sql`case when ${ownsRequest} then 90 else ${clip.encode_priority} end`,
    encode_claimed_request_id: null,
  }
}

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
    const result = await withUploadActivityStopped(id, () =>
      db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            sourceKey: clip.source_key,
            waveformKey: clip.waveform_key,
            cutKey: clip.cut_key,
          })
          .from(clip)
          .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
          .limit(1)
          .for("update")
        if (!current) return { committed: false, queuedDeletions: 0 }

        const [updated] = await tx
          .update(clip)
          .set({
            ...sourcePatchToColumns(patch),
            updated_at: new Date(),
          })
          .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
          .returning({ id: clip.id })
        if (!updated) return { committed: false, queuedDeletions: 0 }

        const intents = mediaAssetDeletionIntents({
          keys: [current.sourceKey, current.waveformKey, current.cutKey],
          retainedKeys: [patch.sourceKey, patch.waveformKey, patch.cutKey],
          reason: "media source replaced",
          source: { type: "media-run", id: runId },
        })
        await enqueueStorageDeletions(intents, { tx })
        const stagedIntents = await deleteUploadTicketsWithStorageIntents(
          { type: "clip", id },
          "media source committed",
          tx,
        )
        return {
          committed: true,
          queuedDeletions: intents.length + stagedIntents,
        }
      }),
    )
    if (result.queuedDeletions > 0) wakeStorageDeletionWorker()
    return result.committed
  },

  async commitThumb(id, runId, patch: MediaThumbPatch) {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ thumbKey: clip.thumb_key })
        .from(clip)
        .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
        .limit(1)
        .for("update")
      if (!current) return { committed: false, queuedDeletions: 0 }

      const [updated] = await tx
        .update(clip)
        .set({ ...thumbPatchToColumns(patch), updated_at: new Date() })
        .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
        .returning({ id: clip.id })
      if (!updated) return { committed: false, queuedDeletions: 0 }

      const intents = mediaAssetDeletionIntents({
        keys: [current.thumbKey],
        retainedKeys: [patch.thumbKey],
        reason: "media thumbnail replaced",
        source: { type: "media-run", id: runId },
      })
      await enqueueStorageDeletions(intents, { tx })
      return { committed: true, queuedDeletions: intents.length }
    })
    if (result.queuedDeletions > 0) wakeStorageDeletionWorker()
    return result.committed
  },

  async commitWaveform(id, runId, waveformKey, completion) {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ waveformKey: clip.waveform_key })
        .from(clip)
        .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
        .limit(1)
        .for("update")
      if (!current) return { committed: false, queuedDeletions: 0 }

      const [updated] = await tx
        .update(clip)
        .set({
          ...finishedAssetLeaseColumns(completion),
          waveform_key: waveformKey,
        })
        .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
        .returning({ id: clip.id })
      if (!updated) return { committed: false, queuedDeletions: 0 }

      const intents = mediaAssetDeletionIntents({
        keys: [current.waveformKey],
        retainedKeys: [waveformKey],
        reason: "media waveform replaced",
        source: { type: "media-run", id: runId },
      })
      await enqueueStorageDeletions(intents, { tx })
      return { committed: true, queuedDeletions: intents.length }
    })
    if (result.queuedDeletions > 0) wakeStorageDeletionWorker()
    return result.committed
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
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(clip)
        .set({
          status: "ready",
          published_at: publishedAtStamp,
          updated_at: new Date(),
        })
        .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
        .returning({ id: clip.id })
      if (!row) return { committed: false, webhookClaims: 0 }
      const webhookClaims = await claimClipPublishedDeliveries(tx, id)
      return { committed: true, webhookClaims }
    })
    wakeClaimedClipPublishedDeliveries(result.webhookClaims)
    return result.committed
  },

  async commitReady(id, runId, patch, renditions, audioTracks, completion) {
    const result = await withUploadActivityStopped(id, () =>
      db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            sourceKey: clip.source_key,
            waveformKey: clip.waveform_key,
            cutKey: clip.cut_key,
            thumbKey: clip.thumb_key,
          })
          .from(clip)
          .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
          .limit(1)
          .for("update")
        if (!current) {
          return {
            committed: false,
            webhookClaims: 0,
            queuedDeletions: 0,
          }
        }

        const previousRenditions = await tx
          .select({ storageKey: clipRendition.storage_key })
          .from(clipRendition)
          .where(eq(clipRendition.clip_id, id))
        const previousAudioTracks = await tx
          .select({ storageKey: clipAudioTrack.storage_key })
          .from(clipAudioTrack)
          .where(eq(clipAudioTrack.clip_id, id))

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
        if (!updated) {
          return {
            committed: false,
            webhookClaims: 0,
            queuedDeletions: 0,
          }
        }

        const mediaIntents = mediaAssetDeletionIntents({
          keys: [
            current.sourceKey,
            current.waveformKey,
            current.cutKey,
            current.thumbKey,
            ...previousRenditions.map((row) => row.storageKey),
            ...previousAudioTracks.map((row) => row.storageKey),
          ],
          retainedKeys: [
            patch.sourceKey,
            patch.waveformKey,
            patch.cutKey,
            patch.thumbKey,
            ...renditions.map((row) => row.storageKey),
            ...audioTracks.map((row) => row.storageKey),
          ],
          reason: "media output replaced",
          source: { type: "media-run", id: runId },
        })
        await enqueueStorageDeletions(mediaIntents, { tx })

        await tx.delete(clipRendition).where(eq(clipRendition.clip_id, id))
        await tx.delete(clipAudioTrack).where(eq(clipAudioTrack.clip_id, id))
        if (renditions.length > 0) {
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
        if (audioTracks.length > 0) {
          await tx.insert(clipAudioTrack).values(
            audioTracks.map((track) => ({
              clip_id: id,
              idx: track.index,
              kind: track.kind,
              label: track.label,
              storage_key: track.storageKey,
              codecs: track.codecs,
              size_bytes: track.sizeBytes,
            })),
          )
        }
        const stagedIntents = await deleteUploadTicketsWithStorageIntents(
          { type: "clip", id },
          "media source committed",
          tx,
        )
        const webhookClaims = await claimClipPublishedDeliveries(tx, id)
        return {
          committed: true,
          webhookClaims,
          queuedDeletions: mediaIntents.length + stagedIntents,
        }
      }),
    )
    if (result.queuedDeletions > 0) wakeStorageDeletionWorker()
    wakeClaimedClipPublishedDeliveries(result.webhookClaims)
    return result.committed
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
    const audioTrackRows = await db
      .select({ storageKey: clipAudioTrack.storage_key })
      .from(clipAudioTrack)
      .where(eq(clipAudioTrack.clip_id, id))
    return {
      ...row,
      renditionKeys: renditionRows.map((rendition) => rendition.storageKey),
      audioTrackKeys: audioTrackRows.map((track) => track.storageKey),
    }
  },

  publishUpsert(authorId, id) {
    void publishClipUpsert(authorId, id)
  },
}
