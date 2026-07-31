import { clip, clipAudioTrack, clipRendition } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { resetFailedClipForEncode } from "@alloy/server/clips/reencode"
import { resolveTrimRange } from "@alloy/server/clips/trim-range"
import { db } from "@alloy/server/db/index"
import {
  enqueueClipEncode,
  requeueClipEncode,
} from "@alloy/server/jobs/kinds/clip-encode"
import { extractPoster } from "@alloy/server/media/poster"
import { runScopedThumbKey } from "@alloy/server/queue/media-asset-keys"
import { withClipSourceWorkDir } from "@alloy/server/queue/media-run-helpers"
import { deleteAssetsBestEffort } from "@alloy/server/queue/media-run-workspace"
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { clipThumbnailStorage } from "@alloy/server/storage/index"
import { and, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"

import { IdParam, PosterBody, TrimBody } from "./clips-helpers"
import {
  selectClipForMutation,
  updatedClipResponse,
} from "./clips-upload-access"
import { zValidator } from "./validation"

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
    zValidator("param", IdParam),
    zValidator("json", PosterBody),
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
      const durationMs = row.source_duration_ms ?? row.duration_ms
      if (durationMs == null || durationMs <= 0) {
        return badRequest(c, "Clip duration is unknown")
      }

      // Timestamps are source-time; clamp into the virtual trim range so the
      // poster always shows a frame the published clip actually contains.
      const timeMs = Math.min(
        Math.max(body.timeMs, row.trim_start_ms ?? 0),
        row.trim_end_ms ?? durationMs,
      )

      const poster = await extractSourcePoster(row.source_key, {
        atMs: timeMs,
        durationMs,
        allowUniform: true,
      })
      if (!poster) return badRequest(c, "Could not extract a poster frame")

      const thumbKey = runScopedThumbKey(id, crypto.randomUUID())
      await clipThumbnailStorage.put(thumbKey, poster.jpeg, "image/jpeg")

      // Guarded on "ready" plus a null encode lease: a reprocess that started
      // meanwhile republishes its own thumbnail at commitReady and would
      // silently clobber this one.
      const [updated] = await db
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
            eq(clip.status, "ready"),
            isNull(clip.encode_run_id),
          ),
        )
        .returning({ id: clip.id })
      if (!updated) {
        await clipThumbnailStorage.delete(thumbKey)
        return conflict(c, "Clip is already processing")
      }

      if (row.thumb_key && row.thumb_key !== thumbKey) {
        await clipThumbnailStorage.delete(row.thumb_key)
      }
      void publishClipUpsert(row.author_id, id)

      return updatedClipResponse(c, id)
    },
  )
  .post(
    "/:id/trim",
    requireSession,
    zValidator("param", IdParam),
    zValidator("json", TrimBody),
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
      const [accepted] = await db
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
            eq(clip.status, "ready"),
            isNull(clip.encode_run_id),
          ),
        )
        .returning({ id: clip.id })
      if (!accepted) return conflict(c, "Clip is already processing")

      // Fireshare-style eager invalidation: the accepted trim makes existing
      // renditions and stems stale, so drop their records before playback can
      // select them. The previously committed cut keeps the clip's cut_key
      // until commitSource swaps in the new exact cut. These records are the
      // only reference the run's stale-asset prune reads (currentAssetKeys),
      // so capture the storage keys and delete the objects here instead of
      // leaking them to the orphan GC.
      const staleRenditions = await db
        .select({ storageKey: clipRendition.storage_key })
        .from(clipRendition)
        .where(eq(clipRendition.clip_id, id))
      const staleAudioTracks = await db
        .select({ storageKey: clipAudioTrack.storage_key })
        .from(clipAudioTrack)
        .where(eq(clipAudioTrack.clip_id, id))
      await db.delete(clipRendition).where(eq(clipRendition.clip_id, id))
      await db.delete(clipAudioTrack).where(eq(clipAudioTrack.clip_id, id))
      await deleteAssetsBestEffort(
        [
          ...staleRenditions.map((rendition) => rendition.storageKey),
          ...staleAudioTracks.map((track) => track.storageKey),
        ],
        "pre-trim derived asset",
      )

      void publishClipUpsert(row.author_id, id)
      await enqueueClipEncode(id, { trigger: "trim", priority: 10 })

      return updatedClipResponse(c, id)
    },
  )
  .post(
    "/:id/re-encode",
    requireSession,
    reEncodeRateLimit,
    zValidator("param", IdParam),
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
        // The encode handler no-ops on failed clips, so flip it back to
        // processing before enqueueing. Guarded on the null lease so a run that
        // just took over isn't clobbered.
        if (!(await resetFailedClipForEncode(id))) {
          return conflict(c, "Clip is already processing")
        }

        void publishClipUpsert(row.author_id, id)
        await enqueueClipEncode(id, { trigger: "reencode", priority: 10 })
        return updatedClipResponse(c, id)
      }

      // Re-encoding a ready clip is full transcode work for something that
      // already plays — operator tooling, not a recovery path. Owners keep the
      // failed-clip retry above; this stays admin-only.
      if (c.var.session.user.role !== "admin") return forbidden(c)

      // Ready clip: re-encode in place, keeping it publicly playable from its
      // committed renditions. Rejected while a live run holds the clip lease,
      // mirroring the trim guard.
      const result = await requeueClipEncode(id, {
        trigger: "reencode",
        priority: 10,
      })
      if (!result.ok) {
        if (result.reason === "active-lease") {
          return conflict(c, "Clip is already processing")
        }
        return notFound(c)
      }

      // The requeued run leaves the clip ready+100, where the watch page's
      // refetchInterval stops polling and never picks up the fresh renditions.
      // Reset encode_progress so polling resumes; guarded like trim on the null
      // lease, and the response re-selects regardless so a run that already
      // leased (progress owned by the run) is tolerated.
      await db
        .update(clip)
        .set({ encode_progress: 0, updated_at: new Date() })
        .where(
          and(
            eq(clip.id, id),
            eq(clip.status, "ready"),
            isNull(clip.encode_run_id),
          ),
        )

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
