import { clip, clipRendition } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { resetFailedClipForEncode } from "@alloy/server/clips/reencode"
import {
  resolveTrimRange,
  trimShowsFrame,
} from "@alloy/server/clips/trim-range"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import {
  createKeyedWork,
  MediaWorkBusyError,
} from "@alloy/server/media/keyed-work"
import { type ExtractedPoster, extractPoster } from "@alloy/server/media/poster"
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
  tooManyRequests,
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
import {
  adoptStorageWrites,
  withReservedStorageWrites,
} from "@alloy/server/storage/write-reservation"
import { and, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { PosterBody, TrimBody } from "./clips-helpers"
import { loadMutableClip, updatedClipResponse } from "./clips-upload-access"
import { IdParam, tbValidator } from "./validation"

// Owner/admin re-encode is non-destructive but enqueues real transcode work,
// so it sits behind a per-IP limiter like the auth routes.
const reEncodeRateLimit = rateLimiter({
  windowMs: 60_000,
  max: 10,
  key: requestIp,
})

// A poster grab runs ffmpeg in the request, outside the media worker and its
// concurrency, so the route bounds it: per IP here, and at most two grabs at
// a time across requests, like the desktop library's frame grabs.
const posterRateLimit = rateLimiter({
  windowMs: 60_000,
  max: 20,
  key: requestIp,
})
const posterWork = createKeyedWork<ExtractedPoster | null>({
  concurrency: 2,
  maxWaiting: 16,
})

async function updateReadyClip(
  tx: DbTransaction,
  input: {
    id: string
    authorId: string
    sourceKey: string
    patch: Partial<typeof clip.$inferInsert>
  },
): Promise<boolean> {
  const [updated] = await tx
    .update(clip)
    .set({ ...input.patch, updated_at: new Date() })
    .where(
      and(
        eq(clip.id, input.id),
        eq(clip.author_id, input.authorId),
        eq(clip.source_key, input.sourceKey),
        eq(clip.status, "ready"),
        isNull(clip.encode_run_id),
      ),
    )
    .returning({ id: clip.id })
  return Boolean(updated)
}

export const clipsUploadMediaRoutes = new Hono()
  .post(
    "/:id/poster",
    requireSession,
    posterRateLimit,
    tbValidator("param", IdParam),
    tbValidator("json", PosterBody),
    loadMutableClip({ allowAdmin: true, statuses: ["ready"] }),
    async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      const row = c.var.clip

      if (row.media_kind === "image")
        return badRequest(c, "This operation requires a video")
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

      let poster: ExtractedPoster | null
      try {
        // Identical requests share one grab. The key names the source, so a
        // clip whose media changed never gets a frame of the old file.
        poster = await posterWork.run(
          `${id}:${sourceKey}:${timeMs}`,
          c.req.raw.signal,
          (signal) =>
            extractSourcePoster(sourceKey, {
              atMs: timeMs,
              durationMs,
              signal,
            }),
        )
      } catch (cause) {
        if (cause instanceof MediaWorkBusyError) {
          return tooManyRequests(c, 5, "Too many posters are being made")
        }
        // The client went away, so nothing reads this response.
        if (c.req.raw.signal.aborted) {
          return badRequest(c, "The request was cancelled")
        }
        throw cause
      }
      if (!poster) return badRequest(c, "Could not extract a poster frame")

      const attemptId = crypto.randomUUID()
      const thumbKey = runScopedThumbKey(id, attemptId)
      const thumb = { namespace: "thumbnails", key: thumbKey } as const
      // Reserved before the upload and fenced until the swap commits. If
      // either fails, or the process dies in between, the reservation
      // deletes the poster unless a row points at it.
      const swapped = await withReservedStorageWrites(
        [thumb],
        attemptId,
        async () => {
          await clipThumbnailStorage.put(thumbKey, poster.jpeg, "image/jpeg")

          // Guarded on "ready" plus a null encode lease: a reprocess that
          // started meanwhile republishes its own thumbnail at commitReady
          // and would silently clobber this one. Locking and re-reading also
          // serializes two poster requests so the second one retires the
          // first request's key, rather than both acting on the stale
          // pre-upload snapshot.
          return db.transaction(async (tx) => {
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

            const accepted = await updateReadyClip(tx, {
              id,
              authorId: row.author_id,
              sourceKey,
              patch: {
                thumb_key: thumbKey,
                thumb_blur_hash: poster.blurHash,
                thumb_failed_at: null,
                // Marks the poster as picked, so reprocessing keeps it.
                thumb_time_ms: timeMs,
              },
            })
            if (accepted) await adoptStorageWrites([thumb], tx)
            const intents = posterDeletionIntents({
              previousKey: current.thumbKey,
              uploadedKey: thumbKey,
              accepted,
              attemptId,
            })
            await enqueueStorageDeletions(intents, { tx })
            return { accepted, queuedDeletions: intents.length }
          })
        },
      )
      // Woken only once the fence is gone, which would otherwise defer the
      // rejected poster's deletion.
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
    loadMutableClip({ statuses: ["ready"] }),
    async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      const row = c.var.clip

      if (row.media_kind === "image")
        return badRequest(c, "This operation requires a video")
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
      // renditions stale, so drop their records before playback can
      // select them. The previously committed cut keeps the clip's cut_key
      // until commitSource swaps in the new exact cut. Snapshot the derived
      // references and enqueue their durable deletion intents in the same
      // transaction that invalidates their rows.
      const trimmed = await db.transaction(async (tx) => {
        // Locked like the poster route does, so a poster picked meanwhile
        // is either seen here or rejected once the clip is processing.
        const [poster] = await tx
          .select({ thumbKey: clip.thumb_key, thumbTimeMs: clip.thumb_time_ms })
          .from(clip)
          .where(eq(clip.id, id))
          .limit(1)
          .for("update")
        // The new cut gets an automatic poster of its own. A picked poster
        // stays while the cut still shows its frame; any other poster may
        // show footage the owner just cut, so it goes with this trim.
        const stalePosterKey =
          poster?.thumbKey &&
          (poster.thumbTimeMs === null ||
            !trimShowsFrame(range, poster.thumbTimeMs, durationMs))
            ? poster.thumbKey
            : null
        const patch: Partial<typeof clip.$inferInsert> = {
          trim_start_ms: range?.startMs ?? null,
          trim_end_ms: range?.endMs ?? null,
          status: "processing",
          encode_progress: 0,
          encode_attempt: 0,
          failure_reason: null,
        }
        if (stalePosterKey) {
          patch.thumb_key = null
          patch.thumb_blur_hash = null
          patch.thumb_time_ms = null
        }
        const accepted = await updateReadyClip(tx, {
          id,
          authorId: row.author_id,
          sourceKey,
          patch,
        })
        if (!accepted) return null

        const staleRenditions = await tx
          .select({ storageKey: clipRendition.storage_key })
          .from(clipRendition)
          .where(eq(clipRendition.clip_id, id))
        const intents = mediaAssetDeletionIntents({
          keys: [
            ...staleRenditions.map((rendition) => rendition.storageKey),
            stalePosterKey,
          ],
          reason: "trim invalidated derived media",
          source: { type: "clip-trim", id },
        })
        await enqueueStorageDeletions(intents, { tx })
        await tx.delete(clipRendition).where(eq(clipRendition.clip_id, id))
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
    loadMutableClip({ allowAdmin: true, statuses: ["ready", "failed"] }),
    async (c) => {
      const { id } = c.req.valid("param")
      const row = c.var.clip

      if (row.status === "failed") {
        // Failed clips are not claimable, so flip it back to processing in the
        // same transaction that creates the durable media request. The run-ID
        // guard stops a run that just took over from being clobbered. The
        // media guard refuses a clip with nothing to encode from, since every
        // attempt would fail: failed uploads, and earlier servers on a failed
        // run, deleted the upload.
        const reset = await db.transaction(async (tx) => {
          const result = await resetFailedClipForEncode(id, tx)
          if (result.ok) {
            await requestClipMedia(id, {
              force: true,
              priority: 10,
              clearFailure: true,
              tx,
            })
          }
          return result
        })
        if (!reset.ok) {
          if (reset.reason === "no-media") {
            return conflict(c, "The clip's upload is gone; upload it again")
          }
          if (reset.reason === "active-work") {
            return conflict(c, "Clip is already processing")
          }
          return notFound(c)
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
  opts: { atMs: number; durationMs: number; signal: AbortSignal },
) {
  return withClipSourceWorkDir("poster", sourceKey, ({ workDir, sourcePath }) =>
    extractPoster(sourcePath, workDir, opts),
  )
}
