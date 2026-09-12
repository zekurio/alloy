import { clip } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { requestClipMedia } from "@alloy/server/queue/clip-media-work-store"
import {
  wakeClipMediaWorker,
  withClipMediaStopped,
} from "@alloy/server/queue/clip-media-worker"
import {
  badRequest,
  conflict,
  gone,
  success,
} from "@alloy/server/runtime/http-response"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import {
  completedUploadMatches,
  pendingUploadFinalizationAction,
} from "@alloy/server/uploads/deadline"
import { resolveStagedUpload } from "@alloy/server/uploads/staged"
import {
  assertUsableVideoTicket,
  markUploadTicketUsed,
  markUploadTicketUsedAndExtendDeadline,
  selectVideoTicket,
} from "@alloy/server/uploads/tickets"
import { and, eq, gt } from "drizzle-orm"
import { Hono, type Context } from "hono"

import { IdParam } from "./clips-helpers"
import {
  selectClipForMutation,
  updatedClipResponse,
} from "./clips-upload-access"
import {
  markUploadFailed,
  selectLockedQuotaState,
  type UploadQuotaResult,
  uploadQuotaExceededResponse,
  uploadQuotaResult,
} from "./clips-upload-helpers"
import { clipsUploadInitiateRoutes } from "./clips-upload-initiate"
import { tbValidator } from "./validation"

async function withPendingClipMutation(
  c: Context,
  id: string,
  statuses: readonly string[],
  action: (row: typeof clip.$inferSelect) => Promise<Response>,
): Promise<Response> {
  return withClipMediaStopped(id, () =>
    withUploadActivityStopped(id, async () => {
      const access = await selectClipForMutation(c, {
        id,
        viewerId: c.var.viewerId,
        statuses,
      })
      if ("response" in access) return access.response
      return action(access.row)
    }),
  )
}

export const clipsUploadLifecycleRoutes = new Hono()
  .route("/", clipsUploadInitiateRoutes)
  .post(
    "/:id/finalize",
    requireSession,
    tbValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      return withPendingClipMutation(c, id, ["pending"], async (row) => {
        const videoTicket = await selectVideoTicket({ type: "clip", id })
        const sourceContentType = row.source_content_type
        const sourceSizeBytes = row.source_size_bytes
        if (!videoTicket || !sourceContentType || sourceSizeBytes == null) {
          await markUploadFailed(row.author_id, id, "Upload ticket missing")
          return badRequest(c, "Upload ticket missing")
        }
        const videoTicketKey = videoTicket.storageKey

        const stagedUpload = await resolveStagedUpload(videoTicketKey)
        if (!stagedUpload) {
          await markUploadFailed(row.author_id, id, "Upload bytes are missing")
          return badRequest(c, "Upload bytes are missing")
        }

        const finalizationAction = pendingUploadFinalizationAction(
          videoTicket,
          stagedUpload,
          row.upload_cleanup_at,
          new Date(),
        )
        let recovered = false
        if (finalizationAction === "recover") {
          recovered = await markUploadTicketUsedAndExtendDeadline(
            videoTicket.id,
            configStore.get("limits").uploadTtlSec,
            { expectedCleanupAt: row.upload_cleanup_at },
          )
          if (!recovered) {
            return conflict(c, "Clip upload ownership changed")
          }
        }

        const videoTicketOk =
          recovered ||
          (finalizationAction === "usable" &&
            (await assertUsableVideoTicket({
              target: { type: "clip", id },
              storageKey: videoTicketKey,
              contentType: sourceContentType,
              expectedBytes: sourceSizeBytes,
              uploadCleanupAt: row.upload_cleanup_at,
            })))
        if (!videoTicketOk) {
          await markUploadFailed(row.author_id, id, "Upload ticket expired")
          return gone(c, "Upload ticket expired")
        }

        const quotaResult = await db.transaction<UploadQuotaResult>(
          async (tx) => {
            const { quotaBytes, usedBytes } = await selectLockedQuotaState(
              tx,
              viewerId,
            )
            return uploadQuotaResult({
              quotaBytes,
              usedBytes,
              reservedBytes: sourceSizeBytes,
              incomingBytes: stagedUpload.size,
            })
          },
        )
        if (!quotaResult.ok) {
          await markUploadFailed(row.author_id, id, "Storage quota exceeded")
          return uploadQuotaExceededResponse(c, quotaResult)
        }

        if (stagedUpload.size !== sourceSizeBytes) {
          await markUploadFailed(
            row.author_id,
            id,
            "Upload size did not match declared size",
          )
          return badRequest(c, "Upload size did not match declared size")
        }
        if (
          !completedUploadMatches(stagedUpload, {
            bytes: sourceSizeBytes,
            contentType: sourceContentType,
          })
        ) {
          await markUploadFailed(
            row.author_id,
            id,
            "Upload content type did not match declared type",
          )
          return badRequest(
            c,
            "Upload content type did not match declared type",
          )
        }

        const transitioned = await db.transaction(async (tx) => {
          const finalizedAt = new Date()
          const [row] = await tx
            .update(clip)
            .set({
              status: "processing",
              upload_cleanup_at: null,
              source_size_bytes: stagedUpload.size,
              updated_at: new Date(),
            })
            .where(
              and(
                eq(clip.id, id),
                eq(clip.author_id, viewerId),
                eq(clip.status, "pending"),
                gt(clip.upload_cleanup_at, finalizedAt),
              ),
            )
            .returning({ id: clip.id })
          if (!row) return null
          await markUploadTicketUsed(videoTicket.id, finalizedAt, tx)
          await requestClipMedia(id, {
            force: false,
            priority: 10,
            clearFailure: true,
            tx,
          })
          return row
        })
        if (!transitioned) {
          return conflict(c, "Clip is already being finalized")
        }
        wakeClipMediaWorker()

        void publishClipUpsert(viewerId, id)

        return updatedClipResponse(c, id)
      })
    },
  )
  .post(
    "/:id/fail",
    requireSession,
    tbValidator("param", IdParam),
    async (c) => {
      const { id } = c.req.valid("param")
      return withPendingClipMutation(
        c,
        id,
        ["pending", "processing"],
        async (row) => {
          await markUploadFailed(row.author_id, id, "Upload failed")
          return success(c)
        },
      )
    },
  )
