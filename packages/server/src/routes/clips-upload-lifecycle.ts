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
  mintStagedUpload,
  resolveStagedUpload,
  stagedSourceKey,
} from "@alloy/server/uploads/staged"
import {
  assertUsableVideoTicket,
  createUploadTickets,
  deleteUploadTicketsWithStorageIntents,
  selectVideoTicket,
} from "@alloy/server/uploads/tickets"
import { and, eq } from "drizzle-orm"
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
  uploads: Array<{
    key: string | null
  }>,
): Promise<void> {
  let queued = 0
  try {
    queued = await db.transaction(async (tx) => {
      let intents = 0
      for (const upload of uploads) {
        if (!upload.key) continue
        await enqueueStorageDeletion(
          stagedUploadDeletionIntent({
            key: upload.key,
            reason: "clip initiation failed",
            source: { type: "clip-initiate", id: clipId },
          }),
          { tx },
        )
        intents += 1
      }
      intents += await deleteUploadTicketsWithStorageIntents(
        { type: "clip", id: clipId },
        "clip initiation failed",
        tx,
      )
      await tx.delete(clip).where(eq(clip.id, clipId))
      return intents
    })
  } catch (err) {
    logger.warn(`failed to detach clip ${clipId} after initiate failure:`, err)
    return
  }
  if (queued > 0) wakeStorageDeletionWorker()
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
      return withUploadActivityStopped(clipId, async () => {
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

        const initiateResult = await db.transaction<InitiateTransactionResult>(
          async (tx) => {
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
            const queuedDeletions = await deleteUploadTicketsWithStorageIntents(
              { type: "clip", id: clipId },
              "superseded orphan upload ticket",
              tx,
            )

            return { ok: true, queuedDeletions }
          },
        )

        if (!initiateResult.ok) {
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

        const expiresInSec = configStore.get("limits").uploadTtlSec
        const expiresAt = new Date(Date.now() + expiresInSec * 1000)
        try {
          const videoUpload = await mintStagedUpload({
            key: uploadKey,
            contentType: body.contentType,
            maxBytes: body.sizeBytes,
            expiresInSec,
            userId: viewerId,
            clipId,
          })
          await createUploadTickets({
            target: { type: "clip", id: clipId },
            ownerId: viewerId,
            videoKey: uploadKey,
            videoContentType: body.contentType,
            videoBytes: body.sizeBytes,
            expiresAt,
          })
          return c.json({
            clipId,
            ticket: videoUpload,
          })
        } catch (err) {
          await cleanupFailedInitiate(clipId, [{ key: uploadKey }])
          throw err
        }
      })
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
          const videoTicketKey = videoTicket?.storageKey ?? null
          const sourceContentType = row.source_content_type
          const sourceSizeBytes = row.source_size_bytes
          if (
            !videoTicketKey ||
            !sourceContentType ||
            sourceSizeBytes == null
          ) {
            await markUploadFailed(row.author_id, id, "Upload ticket missing", {
              ownershipStopped: true,
            })
            return badRequest(c, "Upload ticket missing")
          }

          const videoTicketOk = await assertUsableVideoTicket({
            target: { type: "clip", id },
            storageKey: videoTicketKey,
            contentType: sourceContentType,
            expectedBytes: sourceSizeBytes,
          })
          if (!videoTicketOk) {
            await markUploadFailed(row.author_id, id, "Upload ticket expired", {
              ownershipStopped: true,
            })
            return gone(c, "Upload ticket expired")
          }

          const stagedUpload = await resolveStagedUpload(videoTicketKey)
          if (!stagedUpload) {
            await markUploadFailed(
              row.author_id,
              id,
              "Upload bytes are missing",
              {
                ownershipStopped: true,
              },
            )
            return badRequest(c, "Upload bytes are missing")
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
            await markUploadFailed(
              row.author_id,
              id,
              "Storage quota exceeded",
              {
                ownershipStopped: true,
              },
            )
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
              { ownershipStopped: true },
            )
            return badRequest(c, "Upload size did not match declared size")
          }

          const transitioned = await db.transaction(async (tx) => {
            const [row] = await tx
              .update(clip)
              .set({
                status: "processing",
                source_size_bytes: stagedUpload.size,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(clip.id, id),
                  eq(clip.author_id, viewerId),
                  eq(clip.status, "pending"),
                ),
              )
              .returning({ id: clip.id })
            if (!row) return null
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

          await markUploadFailed(row.author_id, id, "Upload failed", {
            ownershipStopped: true,
          })
          return success(c)
        }),
      )
    },
  )
