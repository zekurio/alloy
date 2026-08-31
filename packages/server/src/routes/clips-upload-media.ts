import { clip, clipAudioTrack, clipRendition } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { resetFailedClipForEncode } from "@alloy/server/clips/reencode"
import { resolveTrimRange } from "@alloy/server/clips/trim-range"
import { db } from "@alloy/server/db/index"
import { extractPoster } from "@alloy/server/media/poster"
import {
  requestClipMedia,
  requeueClipMedia,
} from "@alloy/server/queue/clip-media-work-store"
import { wakeClipMediaWorker } from "@alloy/server/queue/clip-media-worker"
import { runScopedThumbKey } from "@alloy/server/queue/media-asset-keys"
import { withClipSourceWorkDir } from "@alloy/server/queue/media-run-helpers"
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { requestIp } from "@alloy/server/runtime/request-ip"
import {
  mediaAssetDeletionIntents,
  posterDeletionIntents,
} from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { clipThumbnailStorage } from "@alloy/server/storage/index"
import { enqueueUnownedMediaAssets } from "@alloy/server/storage/media-deletion"
import { and, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { IdParam, PosterBody, TrimBody } from "./clips-helpers"
import {
  selectClipForMutation,
  updatedClipResponse,
} from "./clips-upload-access"
import { tbValidator } from "./validation"

// Owner/admin re-encode is non-destructive but enqueues real transcode work,
// so it sits behind a per-IP limiter like the auth routes.
const reEncodeRateLimit = rateLimiter({
  windowMs: 60_000,
  max: 10,
  key: requestIp,
})

export const clipsUploadMediaRoutes = new Hono()
  .post(
    "/:id/poster",
    requireSession,
    tbValidator("param", IdParam),
    tbValidator("json", PosterBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const access = await selectClipForMutation(c, {
        id,
        viewerId,
        statuses: ["ready"],
        allowAdmin: true,
      })
      if ("response" in access) return access.response
      const row = access.row

      if (!row.source_key) return badRequest(c, "Clip has no source media")
      const sourceKey = row.source_key
      const durationMs = row.source_duration_ms ?? row.duration_ms
      if (durationMs == null || durationMs <= 0) {
        return badRequest(c, "Clip duration is unknown")
      }

      // Timestamps are source-time; clamp into the committed trim range so the
      // poster always shows a frame the published clip actually contains.
      const timeMs = Math.min(
        Math.max(body.timeMs, row.trim_start_ms ?? 0),
        row.trim_end_ms ?? durationMs,
      )

      const poster = await extractSourcePoster(sourceKey, {
        atMs: timeMs,
        durationMs,
        allowUniform: true,
      })
      if (!poster) return badRequest(c, "Could not extract a poster frame")

      const attemptId = crypto.randomUUID()
      const thumbKey = runScopedThumbKey(id, attemptId)
      try {
        await clipThumbnailStorage.put(thumbKey, poster.jpeg, "image/jpeg")
      } catch (cause) {
        await enqueueUnownedMediaAssets({
          keys: [thumbKey],
          reason: "poster upload failed",
          source: { type: "poster-request", id: attemptId },
        })
        throw cause
      }

      // Guarded on "ready" plus a null encode lease: a reprocess that started
      // meanwhile republishes its own thumbnail at commitReady and would
      // silently clobber this one. Locking and re-reading also serializes two
      // poster requests so the second one retires the first request's key,
      // rather than both acting on the stale pre-upload snapshot.
      let swapped: { accepted: boolean; queuedDeletions: number }
      try {
        swapped = await db.transaction(async (tx) => {
          const [current] = await tx
            .select({
              authorId: clip.author_id,
              sourceKey: clip.source_key,
              status: clip.status,
              encodeRunId: clip.encode_run_id,
              thumbKey: clip.thumb_key,
            })
            .from(clip)
            .where(eq(clip.id, id))
            .limit(1)
            .for("update")

          if (
            !current ||
            current.authorId !== row.author_id ||
            current.sourceKey !== sourceKey ||
            current.status !== "ready" ||
            current.encodeRunId !== null
          ) {
            const intents = posterDeletionIntents({
              previousKey: null,
              uploadedKey: thumbKey,
              accepted: false,
              attemptId,
            })
            await enqueueStorageDeletions(intents, { tx })
            return { accepted: false, queuedDeletions: intents.length }
          }

          const [updated] = await tx
            .update(clip)
            .set({
              thumb_key: thumbKey,
              thumb_blur_hash: poster.blurHash,
              thumb_failed_at: null,
              updated_at: new Date(),
            })
            .where(
              and(
                eq(clip.id, id),
                eq(clip.author_id, row.author_id),
                eq(clip.source_key, sourceKey),
                eq(clip.status, "ready"),
                isNull(clip.encode_run_id),
              ),
            )
            .returning({ id: clip.id })
          const accepted = Boolean(updated)
          const intents = posterDeletionIntents({
            previousKey: current.thumbKey,
            uploadedKey: thumbKey,
            accepted,
            attemptId,
          })
          await enqueueStorageDeletions(intents, { tx })
          return { accepted, queuedDeletions: intents.length }
        })
      } catch (cause) {
        // The upload is already externally visible. If the swap transaction
        // rolls back (or its outcome is uncertain), a live-reference recheck
        // makes this compensating intent safe in either case.
        await enqueueUnownedMediaAssets({
          keys: [thumbKey],
          reason: "poster swap failed",
          source: { type: "poster-request", id: attemptId },
        })
        throw cause
      }
      if (swapped.queuedDeletions > 0) wakeStorageDeletionWorker()
      if (!swapped.accepted) {
        return conflict(c, "Clip is already processing")
      }

      void publishClipUpsert(row.author_id, id)

      return updatedClipResponse(c, id)
    },
  )
  .post(
    "/:id/trim",
    requireSession,
    tbValidator("param", IdParam),
    tbValidator("json", TrimBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const access = await selectClipForMutation(c, {
        id,
        viewerId,
        statuses: ["ready"],
      })
      if ("response" in access) return access.response
      const row = access.row

      if (!row.source_key) return badRequest(c, "Clip has no source media")
      const sourceKey = row.source_key
      const durationMs = row.source_duration_ms ?? row.duration_ms
      if (durationMs == null || durationMs <= 0) {
        return badRequest(c, "Clip duration is unknown")
      }

      const resolved = resolveTrimRange({
        startMs: body.startMs,
        endMs: body.endMs,
        durationMs,
      })
      if (resolved.kind === "invalid") return badRequest(c, resolved.reason)
      // A full-range request clears an existing trim; without one to clear
      // there is nothing to do.
      if (
        resolved.kind === "full-range" &&
        row.trim_start_ms === null &&
        row.trim_end_ms === null &&
        row.cut_key === null
      ) {
        return badRequest(c, "The trim covers the whole clip")
      }
      const range = resolved.kind === "range" ? resolved : null
      // A stale client must not turn an unchanged edit point into a full
      // re-encode. Re-encoding is an explicit owner/admin action elsewhere.
      if (
        range &&
        range.startMs === row.trim_start_ms &&
        range.endMs === row.trim_end_ms &&
        row.cut_key !== null
      ) {
        return badRequest(c, "The trim is unchanged")
      }

      // The status flip is the concurrency guard against other mutations;
      // the null lease additionally excludes a first-ingest run that is
      // already "ready" but still encoding its ladder — its commitReady
      // would otherwise clobber this trim's processing state.
      // Fireshare-style eager invalidation: the accepted trim makes existing
      // renditions and stems stale, so drop their records before playback can
      // select them. The previously committed cut keeps the clip's cut_key
      // until commitSource swaps in the new exact cut. Snapshot the derived
      // references and enqueue their durable deletion intents in the same
      // transaction that invalidates their rows.
      const trimmed = await db.transaction(async (tx) => {
        const [accepted] = await tx
          .update(clip)
          .set({
            trim_start_ms: range?.startMs ?? null,
            trim_end_ms: range?.endMs ?? null,
            status: "processing",
            encode_progress: 0,
            encode_attempt: 0,
            failure_reason: null,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(clip.id, id),
              eq(clip.author_id, row.author_id),
              eq(clip.source_key, sourceKey),
              eq(clip.status, "ready"),
              isNull(clip.encode_run_id),
            ),
          )
          .returning({ id: clip.id })
        if (!accepted) return null

        const staleRenditions = await tx
          .select({ storageKey: clipRendition.storage_key })
          .from(clipRendition)
          .where(eq(clipRendition.clip_id, id))
        const staleAudioTracks = await tx
          .select({ storageKey: clipAudioTrack.storage_key })
          .from(clipAudioTrack)
          .where(eq(clipAudioTrack.clip_id, id))
        const intents = mediaAssetDeletionIntents({
          keys: [
            ...staleRenditions.map((rendition) => rendition.storageKey),
            ...staleAudioTracks.map((track) => track.storageKey),
          ],
          reason: "trim invalidated derived media",
          source: { type: "clip-trim", id },
        })
        await enqueueStorageDeletions(intents, { tx })
        await tx.delete(clipRendition).where(eq(clipRendition.clip_id, id))
        await tx.delete(clipAudioTrack).where(eq(clipAudioTrack.clip_id, id))
        await requestClipMedia(id, {
          force: false,
          priority: 10,
          clearFailure: true,
          tx,
        })
        return { queuedDeletions: intents.length }
      })
      if (!trimmed) return conflict(c, "Clip is already processing")
      if (trimmed.queuedDeletions > 0) wakeStorageDeletionWorker()
      wakeClipMediaWorker()

      void publishClipUpsert(row.author_id, id)

      return updatedClipResponse(c, id)
    },
  )
  .post(
    "/:id/re-encode",
    requireSession,
    reEncodeRateLimit,
    tbValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const access = await selectClipForMutation(c, {
        id,
        viewerId,
        statuses: ["ready", "failed"],
        allowAdmin: true,
      })
      if ("response" in access) return access.response
      const row = access.row

      if (row.status === "failed") {
        // Failed clips are not claimable, so flip it back to processing in the
        // same transaction that creates the durable media request. The run-ID
        // guard stops a run that just took over from being clobbered.
        const queued = await db.transaction(async (tx) => {
          if (!(await resetFailedClipForEncode(id, tx))) return false
          await requestClipMedia(id, {
            force: true,
            priority: 10,
            clearFailure: true,
            tx,
          })
          return true
        })
        if (!queued) {
          return conflict(c, "Clip is already processing")
        }

        wakeClipMediaWorker()
        void publishClipUpsert(row.author_id, id)
        return updatedClipResponse(c, id)
      }

      // A ready clip carrying failure_reason is a recovery path; a clean ready
      // re-encode is full transcode work and stays admin-only.
      if (row.failure_reason === null && c.var.session.user.role !== "admin") {
        return forbidden(c)
      }

      // Ready clip: re-encode in place, keeping it publicly playable from its
      // committed renditions. Reject duplicate queued or running work.
      const result = await requeueClipMedia(id, {
        force: true,
        priority: 10,
        clearFailure: true,
      })
      if (!result.ok) {
        if (result.reason === "active-work") {
          return conflict(c, "Clip is already processing")
        }
        return notFound(c)
      }

      wakeClipMediaWorker()

      void publishClipUpsert(row.author_id, id)
      return updatedClipResponse(c, id)
    },
  )

function extractSourcePoster(
  sourceKey: string,
  opts: { atMs: number; durationMs: number; allowUniform: boolean },
) {
  return withClipSourceWorkDir("poster", sourceKey, ({ workDir, sourcePath }) =>
    extractPoster(sourcePath, workDir, opts),
  )
}
