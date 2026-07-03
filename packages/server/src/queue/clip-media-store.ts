import { clip, clipRendition } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import {
  publishClipProgress,
  publishClipUpsert,
  publishClipUpsertById,
} from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { MEDIA_PIPELINE_VERSION } from "@alloy/server/media/pipeline-version"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm"

import { encodeLeaseConditions, RETRY_DELAY_INTERVAL } from "./lease-conditions"
import type {
  MediaRow,
  MediaSourcePatch,
  MediaStore,
  MediaThumbPatch,
} from "./media-store"

const logger = createLogger("queue")

const leaseConditions = () =>
  encodeLeaseConditions({
    status: clip.status,
    encodeProgress: clip.encode_progress,
    encodeLockedAt: clip.encode_locked_at,
  })

// Ready rows stay ready across a reprocess run so `stream` access (which is
// gated on status = 'ready') keeps serving the committed assets meanwhile.
const keepReadyStatus = sql`case when ${clip.status} = 'ready' then 'ready' else 'processing' end`

const mediaRowSelect = {
  id: clip.id,
  authorId: clip.author_id,
  sourceKey: clip.source_key,
  sourceContentType: clip.source_content_type,
  sourceSizeBytes: clip.source_size_bytes,
  thumbKey: clip.thumb_key,
  thumbBlurHash: clip.thumb_blur_hash,
  trimStartMs: clip.trim_start_ms,
  trimEndMs: clip.trim_end_ms,
  encodeAttempt: clip.encode_attempt,
} as const

function sourcePatchToColumns(patch: MediaSourcePatch) {
  return {
    source_key: patch.sourceKey,
    source_content_type: patch.sourceContentType,
    source_video_codec: patch.sourceVideoCodec,
    source_audio_codec: patch.sourceAudioCodec,
    source_size_bytes: patch.sourceSizeBytes,
    duration_ms: patch.durationMs,
    width: patch.width,
    height: patch.height,
  }
}

function thumbPatchToColumns(patch: MediaThumbPatch) {
  return {
    thumb_key: patch.thumbKey,
    thumb_blur_hash: patch.thumbBlurHash,
  }
}

export const clipMediaStore: MediaStore = {
  target: "clip",

  async selectNextLeasableId(inFlight) {
    const rows = await db
      .select({ id: clip.id })
      .from(clip)
      .where(
        and(
          ...leaseConditions(),
          or(
            isNull(clip.failure_reason),
            lt(
              clip.updated_at,
              sql`now() - interval '${sql.raw(RETRY_DELAY_INTERVAL)}'`,
            ),
          ),
        ),
      )
      .orderBy(clip.updated_at)
      .limit(inFlight.size + 1)
    return rows.find((row) => !inFlight.has(row.id))?.id ?? null
  },

  async lease(id, runId): Promise<MediaRow | null> {
    const [row] = await db
      .update(clip)
      .set({
        // A reprocess of a ready clip (backfill, owner trim retry) keeps the
        // clip publicly playable from its committed assets while this run
        // works; only genuinely unfinished rows show as processing.
        status: keepReadyStatus,
        encode_run_id: runId,
        encode_locked_at: new Date(),
        encode_attempt: sql`${clip.encode_attempt} + 1`,
        failure_reason: null,
        updated_at: new Date(),
      })
      .where(and(eq(clip.id, id), ...leaseConditions()))
      .returning(mediaRowSelect)
    return row ?? null
  },

  async heartbeat(id, runId) {
    const rows = await db
      .update(clip)
      .set({ encode_locked_at: new Date() })
      .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
      .returning({ id: clip.id })
    return rows.length > 0
  },

  async releaseLease(id, runId, reason) {
    await db
      .update(clip)
      .set({
        encode_run_id: null,
        encode_locked_at: null,
        failure_reason: reason.slice(0, 500),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(clip.id, id),
          eq(clip.encode_run_id, runId),
          ne(clip.status, "ready"),
        ),
      )
  },

  async markFailed(id, reason) {
    try {
      const [row] = await db
        .select({ status: clip.status })
        .from(clip)
        .where(eq(clip.id, id))
        .limit(1)
      if (row?.status === "ready") {
        await db
          .update(clip)
          .set({ failure_reason: reason.slice(0, 500), updated_at: new Date() })
          .where(eq(clip.id, id))
        return
      }
      await db
        .update(clip)
        .set({
          status: "failed",
          encode_run_id: null,
          encode_locked_at: null,
          failure_reason: reason.slice(0, 500),
          updated_at: new Date(),
        })
        .where(eq(clip.id, id))
      await cleanupTickets({ type: "clip", id }, `terminal clip ${id} upload`)
      void publishClipUpsertById(id)
    } catch (err) {
      logger.error(`failed to mark clip ${id} as failed:`, err)
    }
  },

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
    const [row] = await db
      .update(clip)
      .set({
        ...sourcePatchToColumns(patch),
        trim_start_ms: null,
        trim_end_ms: null,
        updated_at: new Date(),
      })
      .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
      .returning({ id: clip.id })
    return Boolean(row)
  },

  async commitThumb(id, runId, patch: MediaThumbPatch) {
    const [row] = await db
      .update(clip)
      .set({ ...thumbPatchToColumns(patch), updated_at: new Date() })
      .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
      .returning({ id: clip.id })
    return Boolean(row)
  },

  async commitReady(id, runId, patch, renditions) {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(clip)
        .set({
          ...sourcePatchToColumns(patch),
          ...thumbPatchToColumns(patch),
          status: "ready",
          encode_pipeline: MEDIA_PIPELINE_VERSION,
          encode_progress: 100,
          encode_run_id: null,
          encode_locked_at: null,
          failure_reason: null,
          updated_at: new Date(),
        })
        .where(and(eq(clip.id, id), eq(clip.encode_run_id, runId)))
        .returning({ id: clip.id })
      if (!updated) return false

      await tx.delete(clipRendition).where(eq(clipRendition.clip_id, id))
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
            playlist: rendition.playlist,
            codecs: rendition.codecs,
            bandwidth: rendition.bandwidth,
            size_bytes: rendition.sizeBytes,
          })),
        )
      }
      return true
    })
  },

  async currentAssetKeys(id) {
    const [row] = await db
      .select({ sourceKey: clip.source_key, thumbKey: clip.thumb_key })
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
