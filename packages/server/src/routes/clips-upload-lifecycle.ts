import { normalizeTags } from "@alloy/contracts"
import { clip, clipMention, clipTag } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { resolveTrimRange } from "@alloy/server/clips/trim-range"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { getGameRefById } from "@alloy/server/games/ref"
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
import { stagedUploadDeletionIntent } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletion } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import {
  completedUploadMatches,
  pendingUploadFinalizationAction,
  uploadTicketDeadline,
} from "@alloy/server/uploads/deadline"
import { commitUploadInitiateAndWake } from "@alloy/server/uploads/expiry"
import {
  mintStagedUpload,
  resolveStagedUpload,
  stagedSourceKey,
} from "@alloy/server/uploads/staged"
import {
  assertUsableVideoTicket,
  createUploadTickets,
  deleteUploadTicketsWithStorageIntents,
  markUploadTicketUsed,
  markUploadTicketUsedAndExtendDeadline,
  selectVideoTicket,
} from "@alloy/server/uploads/tickets"
import { accountDeletionState } from "@alloy/server/users/account-deletion-state"
import { and, eq, gt } from "drizzle-orm"
import { Hono } from "hono"

import { IdParam, InitiateBody } from "./clips-helpers"
import {
  selectClipForMutation,
  updatedClipResponse,
} from "./clips-upload-access"
import {
  markUploadFailed,
  resolveMentionIds,
  selectLockedQuotaState,
  type UploadQuotaResult,
  uploadWouldExceedQuota,
} from "./clips-upload-helpers"
import { tbValidator } from "./validation"

const logger = createLogger("clips")

type InitiateTransactionResult =
  | { ok: true; queuedDeletions: number }
  | { ok: false; usedBytes: number; quotaBytes: number }
  | { ok: false; reason: "id-conflict" }

async function cleanupFailedInitiate(
  clipId: string,
  uploadKey: string,
): Promise<void> {
  try {
    await enqueueStorageDeletion(
      stagedUploadDeletionIntent({
        key: uploadKey,
        reason: "clip initiation failed",
        source: { type: "clip-initiate", id: clipId },
      }),
    )
  } catch (err) {
    logger.warn(
      `failed to compensate upload key for clip ${clipId} after initiate failure:`,
      err,
    )
    return
  }
}

function uploadQuotaResult({
  quotaBytes,
  usedBytes,
  reservedBytes,
  incomingBytes,
}: {
  quotaBytes: number | null
  usedBytes: number
  reservedBytes?: number
  incomingBytes: number
}): UploadQuotaResult {
  if (
    quotaBytes !== null &&
    uploadWouldExceedQuota({
      quotaBytes,
      usedBytes,
      reservedBytes,
      incomingBytes,
    })
  ) {
    return { ok: false, usedBytes, quotaBytes }
  }
  return { ok: true }
}

export const clipsUploadLifecycleRoutes = new Hono()
  .post(
    "/initiate",
    requireSession,
    tbValidator("json", InitiateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const body = c.req.valid("json")

      const clipId = (body.clientClipId ?? crypto.randomUUID()).toLowerCase()
      const uploadKey = stagedSourceKey(
        clipId,
        body.contentType,
        crypto.randomUUID(),
      )
      const initiate = () =>
        withUploadActivityStopped(clipId, async () => {
          const privacy = body.privacy ?? "public"
          const trim =
            body.trimStartMs !== undefined &&
            body.trimEndMs !== undefined &&
            body.durationMs !== undefined
              ? resolveTrimRange({
                  startMs: body.trimStartMs,
                  endMs: body.trimEndMs,
                  durationMs: body.durationMs,
                })
              : null

          let gameRef: Awaited<ReturnType<typeof getGameRefById>> = null
          if (body.gameId !== undefined && body.gameId !== null) {
            gameRef = await getGameRefById(body.gameId)
            if (!gameRef) return badRequest(c, "Unknown game")
          }

          const mentionedIds = body.mentionedUserIds
            ? await resolveMentionIds(body.mentionedUserIds, viewerId)
            : []

          const expiresInSec = configStore.get("limits").uploadTtlSec
          let videoUpload: Awaited<ReturnType<typeof mintStagedUpload>>
          try {
            videoUpload = await mintStagedUpload({
              key: uploadKey,
              contentType: body.contentType,
              maxBytes: body.sizeBytes,
              expiresInSec,
              userId: viewerId,
              clipId,
            })
          } catch (err) {
            await cleanupFailedInitiate(clipId, uploadKey)
            throw err
          }
          const expiresAt = uploadTicketDeadline(videoUpload.expiresAt)

          let initiateResult: InitiateTransactionResult
          try {
            initiateResult = await commitUploadInitiateAndWake(() =>
              db.transaction<InitiateTransactionResult>(async (tx) => {
                const { quotaBytes, usedBytes } = await selectLockedQuotaState(
                  tx,
                  viewerId,
                )
                const quota = uploadQuotaResult({
                  quotaBytes,
                  usedBytes,
                  incomingBytes: body.sizeBytes,
                })
                if (!quota.ok) return quota

                const [inserted] = await tx
                  .insert(clip)
                  .values({
                    id: clipId,
                    author_id: viewerId,
                    title: body.title,
                    description: body.description ?? null,
                    game: gameRef?.name ?? null,
                    game_id: gameRef?.id ?? null,
                    privacy,
                    source_content_type: body.contentType,
                    source_size_bytes: body.sizeBytes,
                    pending_audio_tracks: body.audioTracks ?? null,
                    // Client-probed hints so placeholders keep the media's shape
                    // while processing; the media run re-probes and overwrites them.
                    width: body.width ?? null,
                    height: body.height ?? null,
                    duration_ms: body.durationMs ?? null,
                    // Kept source range applied by the media run at first ingest —
                    // full-range requests are dropped and the raw upload is stored
                    // untouched while the run derives any real cut.
                    trim_start_ms: trim
                      ? trim.kind === "range"
                        ? trim.startMs
                        : null
                      : (body.trimStartMs ?? null),
                    trim_end_ms: trim
                      ? trim.kind === "range"
                        ? trim.endMs
                        : null
                      : (body.trimEndMs ?? null),
                    status: "pending",
                    upload_cleanup_at: expiresAt,
                  })
                  .onConflictDoNothing()
                  .returning({ id: clip.id })
                if (!inserted) return { ok: false, reason: "id-conflict" }

                if (mentionedIds.length > 0) {
                  await tx.insert(clipMention).values(
                    mentionedIds.map((mentionedUserId) => ({
                      clip_id: clipId,
                      mentioned_user_id: mentionedUserId,
                    })),
                  )
                }

                const tags = body.tags ? normalizeTags(body.tags) : []
                if (tags.length > 0) {
                  await tx
                    .insert(clipTag)
                    .values(tags.map((tag) => ({ clip_id: clipId, tag })))
                }

                // Older servers could leave a ticket behind after its clip row was
                // deleted between reservation and ticket creation. The exclusive
                // upload gate has drained any issued token before we detach those
                // legacy owners. The new attempt uses a versioned key, so its
                // object can never alias the deletion intent below.
                const queuedDeletions =
                  await deleteUploadTicketsWithStorageIntents(
                    { type: "clip", id: clipId },
                    "superseded orphan upload ticket",
                    tx,
                  )

                await createUploadTickets(
                  {
                    target: { type: "clip", id: clipId },
                    ownerId: viewerId,
                    videoKey: uploadKey,
                    videoContentType: body.contentType,
                    videoBytes: body.sizeBytes,
                    expiresAt,
                  },
                  { tx },
                )

                return { ok: true, queuedDeletions }
              }),
            )
          } catch (err) {
            await cleanupFailedInitiate(clipId, uploadKey)
            throw err
          }

          if (!initiateResult.ok) {
            await cleanupFailedInitiate(clipId, uploadKey)
            if ("reason" in initiateResult) {
              return conflict(c, "Clip upload already exists")
            }
            return c.json(
              {
                error: "Storage quota exceeded",
                usedBytes: initiateResult.usedBytes,
                quotaBytes: initiateResult.quotaBytes,
              },
              413,
            )
          }

          if (initiateResult.queuedDeletions > 0) {
            wakeStorageDeletionWorker()
          }

          void publishClipUpsert(viewerId, clipId)
          return c.json({
            clipId,
            ticket: videoUpload,
          })
        })
      const initiated = await accountDeletionState.withInactive(
        viewerId,
        initiate,
      )
      if (!initiated.ok) {
        return conflict(c, "Account deletion is in progress")
      }
      return initiated.value
    },
  )
  .post(
    "/:id/finalize",
    requireSession,
    tbValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      return withClipMediaStopped(id, () =>
        withUploadActivityStopped(id, async () => {
          const access = await selectClipForMutation(c, {
            id,
            viewerId,
            statuses: ["pending"],
          })
          if ("response" in access) return access.response
          const row = access.row

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
            await markUploadFailed(
              row.author_id,
              id,
              "Upload bytes are missing",
            )
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
            return c.json(
              {
                error: "Storage quota exceeded",
                usedBytes: quotaResult.usedBytes,
                quotaBytes: quotaResult.quotaBytes,
              },
              413,
            )
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
        }),
      )
    },
  )
  .post(
    "/:id/fail",
    requireSession,
    tbValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      return withClipMediaStopped(id, () =>
        withUploadActivityStopped(id, async () => {
          const access = await selectClipForMutation(c, {
            id,
            viewerId,
            statuses: ["pending", "processing"],
          })
          if ("response" in access) return access.response
          const row = access.row

          await markUploadFailed(row.author_id, id, "Upload failed")
          return success(c)
        }),
      )
    },
  )
