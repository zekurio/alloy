import { normalizeTags } from "@alloy/contracts"
import { clip, clipMention, clipTag } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { getSteamGridDBGameRef } from "@alloy/server/games/ref"
import { enqueueClipMediaProcessing } from "@alloy/server/queue/index"
import {
  badRequest,
  conflict,
  errorResult,
  gone,
  success,
} from "@alloy/server/runtime/http-response"
import type { UploadTicketStorageState } from "@alloy/server/storage/index"
import {
  deleteStagedUpload,
  deleteStagedUploads,
  mintStagedUpload,
  parseUploadTicketStorageState,
  resolveStagedUpload,
  stagedSourceKey,
  stagedThumbKey,
} from "@alloy/server/uploads/staged"
import {
  assertUsableVideoTicket,
  createUploadTickets,
  selectVideoTicket,
  THUMB_UPLOAD_MAX_BYTES,
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
import { steamgriddbErrorResponse } from "./games-helpers"
import { zValidator } from "./validation"

const logger = createLogger("clips")

async function cleanupFailedInitiate(
  clipId: string,
  uploadKey: string,
  uploadState: UploadTicketStorageState = null,
): Promise<void> {
  try {
    await db.delete(clip).where(eq(clip.id, clipId))
  } catch (err) {
    logger.warn(`failed to delete clip ${clipId} after initiate failure:`, err)
  }

  try {
    await deleteStagedUpload(uploadKey, uploadState)
  } catch (err) {
    logger.warn(
      `failed to delete staged upload for ${clipId} after initiate failure:`,
      err,
    )
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
    zValidator("json", InitiateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const body = c.req.valid("json")

      const clipId = crypto.randomUUID()
      const uploadKey = stagedSourceKey(clipId, body.contentType)
      const thumbUploadKey = stagedThumbKey(clipId)
      const privacy = body.privacy ?? "public"

      let gameRef: Awaited<ReturnType<typeof getSteamGridDBGameRef>> = null
      if (body.steamgriddbId !== undefined && body.steamgriddbId !== null) {
        try {
          gameRef = await getSteamGridDBGameRef(body.steamgriddbId)
        } catch (err) {
          return errorResult(c, steamgriddbErrorResponse(err))
        }
        if (!gameRef) return badRequest(c, "Unknown game")
      }

      const mentionedIds = body.mentionedUserIds
        ? await resolveMentionIds(body.mentionedUserIds, viewerId)
        : []

      const quotaResult = await db.transaction<UploadQuotaResult>(
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

          await tx.insert(clip).values({
            id: clipId,
            authorId: viewerId,
            title: body.title,
            description: body.description ?? null,
            game: gameRef?.name ?? null,
            steamgriddbId: gameRef?.steamgriddbId ?? null,
            privacy,
            sourceContentType: body.contentType,
            sourceSizeBytes: body.sizeBytes,
            // Client-provided placeholder; media processing recomputes the
            // canonical hash from the published thumbnail.
            thumbBlurHash: body.thumbBlurHash ?? null,
            status: "pending",
          })

          if (mentionedIds.length > 0) {
            await tx.insert(clipMention).values(
              mentionedIds.map((mentionedUserId) => ({
                clipId,
                mentionedUserId,
              })),
            )
          }

          const tags = body.tags ? normalizeTags(body.tags) : []
          if (tags.length > 0) {
            await tx
              .insert(clipTag)
              .values(tags.map((tag) => ({ clipId, tag })))
          }

          return { ok: true }
        },
      )

      if (!quotaResult.ok) {
        return c.json(
          {
            error: "Storage quota exceeded",
            usedBytes: quotaResult.usedBytes,
            quotaBytes: quotaResult.quotaBytes,
          },
          413,
        )
      }

      void publishClipUpsert(viewerId, clipId)

      const expiresInSec = configStore.get("limits").uploadTtlSec
      const expiresAt = new Date(Date.now() + expiresInSec * 1000)
      let videoUploadState: UploadTicketStorageState = null
      try {
        const videoUpload = await mintStagedUpload({
          key: uploadKey,
          contentType: body.contentType,
          maxBytes: body.sizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId,
          role: "video",
        })
        videoUploadState = videoUpload.storageState
        const thumbUpload = await mintStagedUpload({
          key: thumbUploadKey,
          contentType: body.thumbContentType,
          maxBytes: THUMB_UPLOAD_MAX_BYTES,
          expiresInSec,
          userId: viewerId,
          clipId,
          role: "thumb",
        })
        await createUploadTickets({
          target: { type: "clip", id: clipId },
          ownerId: viewerId,
          videoKey: uploadKey,
          videoContentType: body.contentType,
          videoBytes: body.sizeBytes,
          videoUploadState: videoUpload.storageState,
          thumbKey: thumbUploadKey,
          thumbContentType: body.thumbContentType,
          thumbUploadState: thumbUpload.storageState,
          expiresAt,
        })
        return c.json({
          clipId,
          ticket: videoUpload.ticket,
          thumbTicket: thumbUpload.ticket,
        })
      } catch (err) {
        await cleanupFailedInitiate(clipId, uploadKey, videoUploadState)
        throw err
      }
    },
  )
  .post(
    "/:id/finalize",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const access = await selectClipForMutation(c, {
        id,
        viewerId,
        statuses: ["pending"],
      })
      if ("response" in access) return access.response
      const row = access.row

      const videoTicket = await selectVideoTicket({ type: "clip", id })
      const videoTicketKey = videoTicket?.storageKey ?? null
      const videoUploadState = videoTicket?.usedAt
        ? null
        : parseUploadTicketStorageState(videoTicket?.uploadState)
      const sourceContentType = row.sourceContentType
      const sourceSizeBytes = row.sourceSizeBytes
      if (!videoTicketKey || !sourceContentType || sourceSizeBytes == null) {
        await markUploadFailed(row.authorId, id, "Upload ticket missing")
        return badRequest(c, "Upload ticket missing")
      }

      const videoTicketOk = await assertUsableVideoTicket({
        target: { type: "clip", id },
        storageKey: videoTicketKey,
        contentType: sourceContentType,
        expectedBytes: sourceSizeBytes,
      })
      if (!videoTicketOk) {
        await deleteStagedUpload(videoTicketKey, videoUploadState)
        await markUploadFailed(row.authorId, id, "Upload ticket expired")
        return gone(c, "Upload ticket expired")
      }

      const stagedUpload = await resolveStagedUpload(videoTicketKey)
      if (!stagedUpload) {
        await deleteStagedUpload(videoTicketKey, videoUploadState)
        await markUploadFailed(row.authorId, id, "Upload bytes are missing")
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
        await deleteStagedUpload(videoTicketKey, videoUploadState)
        await markUploadFailed(row.authorId, id, "Storage quota exceeded")
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
        await deleteStagedUpload(videoTicketKey, videoUploadState)
        await markUploadFailed(
          row.authorId,
          id,
          "Upload size did not match declared size",
        )
        return badRequest(c, "Upload size did not match declared size")
      }

      const [transitioned] = await db
        .update(clip)
        .set({
          status: "processing",
          sourceSizeBytes: stagedUpload.size,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(clip.id, id),
            eq(clip.authorId, viewerId),
            eq(clip.status, "pending"),
          ),
        )
        .returning({ id: clip.id })
      if (!transitioned) {
        return conflict(c, "Clip is already being finalized")
      }

      void publishClipUpsert(viewerId, id)
      enqueueClipMediaProcessing(id)

      return updatedClipResponse(c, id)
    },
  )
  .post(
    "/:id/fail",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const access = await selectClipForMutation(c, {
        id,
        viewerId,
        statuses: ["pending", "processing"],
      })
      if ("response" in access) return access.response
      const row = access.row

      await deleteStagedUploads(
        [
          await selectVideoTicket({ type: "clip", id }).then((ticket) =>
            ticket
              ? {
                  key: ticket.storageKey,
                  uploadState: ticket.usedAt ? null : ticket.uploadState,
                }
              : null,
          ),
          stagedThumbKey(id),
        ],
        "failed staged upload",
      )
      await markUploadFailed(row.authorId, id, "Upload failed")
      return success(c)
    },
  )
