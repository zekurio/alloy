import { normalizeTags } from "@alloy/contracts"
import {
  clip,
  clipMention,
  clipTag,
  gameSession,
  userDevice,
} from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { resolvePersistedGameByName } from "@alloy/server/games/lookup"
import { getSteamGridGameRef } from "@alloy/server/games/ref"
import { isConfigured as isSteamGridDBConfigured } from "@alloy/server/games/steamgriddb"
import { enqueueClipMediaProcessing } from "@alloy/server/queue/index"
import {
  badRequest,
  conflict,
  errorResult,
  gone,
  serviceUnavailable,
  success,
} from "@alloy/server/runtime/http-response"
import {
  deleteStagedUpload,
  deleteStagedUploads,
  mintStagedUploadUrl,
  resolveStagedUpload,
  stagedSourceKey,
  stagedThumbKey,
} from "@alloy/server/uploads/staged"
import {
  assertUsableVideoTicket,
  createUploadTickets,
  selectVideoTicketKey,
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
import { sgdbErrorResponse } from "./games-helpers"
import { zValidator } from "./validation"

const logger = createLogger("clips")

async function cleanupFailedInitiate(
  clipId: string,
  uploadKey: string,
): Promise<void> {
  try {
    await db.delete(clip).where(eq(clip.id, clipId))
  } catch (err) {
    logger.warn(`failed to delete clip ${clipId} after initiate failure:`, err)
  }

  try {
    await deleteStagedUpload(uploadKey)
  } catch (err) {
    logger.warn(
      `failed to delete staged upload for ${clipId} after initiate failure:`,
      err,
    )
  }
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

      let steamgriddbId: number
      let gameName: string
      if (body.steamgriddbId != null) {
        if (!isSteamGridDBConfigured()) {
          return serviceUnavailable(c, "SteamGridDB is not configured")
        }
        let gameRef: Awaited<ReturnType<typeof getSteamGridGameRef>>
        try {
          gameRef = await getSteamGridGameRef(body.steamgriddbId)
        } catch (err) {
          return errorResult(c, sgdbErrorResponse(err))
        }
        if (!gameRef) return badRequest(c, "Unknown game")
        steamgriddbId = body.steamgriddbId
        gameName = gameRef.name
      } else {
        // Uploads only know the detected process name; resolve it to a game
        // that's persisted in the `game` table so the clip's FK holds.
        const match = await resolvePersistedGameByName(
          body.gameName ?? "",
          viewerId,
        )
        if (!match) return c.json({ error: "game-unresolved" }, 422)
        steamgriddbId = match.steamgriddbId
        gameName = match.name
      }

      if (body.originDeviceId) {
        const [device] = await db
          .select({ id: userDevice.id })
          .from(userDevice)
          .where(
            and(
              eq(userDevice.id, body.originDeviceId),
              eq(userDevice.userId, viewerId),
            ),
          )
          .limit(1)
        if (!device) return badRequest(c, "Unknown device")
      }
      if (body.gameSessionId) {
        const [session] = await db
          .select({ id: gameSession.id })
          .from(gameSession)
          .where(
            and(
              eq(gameSession.id, body.gameSessionId),
              eq(gameSession.userId, viewerId),
            ),
          )
          .limit(1)
        if (!session) return badRequest(c, "Unknown play session")
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
          if (
            quotaBytes !== null &&
            uploadWouldExceedQuota({
              quotaBytes,
              usedBytes,
              incomingBytes: body.sizeBytes,
            })
          ) {
            return { ok: false, usedBytes, quotaBytes }
          }

          await tx.insert(clip).values({
            id: clipId,
            authorId: viewerId,
            title: body.title,
            description: body.description ?? null,
            game: gameName,
            steamgriddbId,
            privacy,
            originDeviceId: body.originDeviceId ?? null,
            gameSessionId: body.gameSessionId ?? null,
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
      try {
        await createUploadTickets({
          target: { type: "clip", id: clipId },
          ownerId: viewerId,
          videoKey: uploadKey,
          videoContentType: body.contentType,
          videoBytes: body.sizeBytes,
          thumbKey: thumbUploadKey,
          thumbContentType: body.thumbContentType,
          expiresAt,
        })
        const ticket = await mintStagedUploadUrl({
          key: uploadKey,
          contentType: body.contentType,
          maxBytes: body.sizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId,
        })
        const thumbTicket = await mintStagedUploadUrl({
          key: thumbUploadKey,
          contentType: body.thumbContentType,
          maxBytes: THUMB_UPLOAD_MAX_BYTES,
          expiresInSec,
          userId: viewerId,
          clipId,
        })
        return c.json({ clipId, ticket, thumbTicket })
      } catch (err) {
        await cleanupFailedInitiate(clipId, uploadKey)
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

      const videoTicketKey = await selectVideoTicketKey({ type: "clip", id })
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
        await deleteStagedUpload(videoTicketKey)
        await markUploadFailed(row.authorId, id, "Upload ticket expired")
        return gone(c, "Upload ticket expired")
      }

      const stagedUpload = await resolveStagedUpload(videoTicketKey)
      if (!stagedUpload) {
        await deleteStagedUpload(videoTicketKey)
        await markUploadFailed(row.authorId, id, "Upload bytes are missing")
        return badRequest(c, "Upload bytes are missing")
      }

      const quotaResult = await db.transaction<UploadQuotaResult>(
        async (tx) => {
          const { quotaBytes, usedBytes } = await selectLockedQuotaState(
            tx,
            viewerId,
          )
          if (
            quotaBytes !== null &&
            uploadWouldExceedQuota({
              quotaBytes,
              usedBytes,
              reservedBytes: sourceSizeBytes,
              incomingBytes: stagedUpload.size,
            })
          ) {
            return { ok: false, usedBytes, quotaBytes }
          }
          return { ok: true }
        },
      )
      if (!quotaResult.ok) {
        await deleteStagedUpload(videoTicketKey)
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
        await deleteStagedUpload(videoTicketKey)
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
        [await selectVideoTicketKey({ type: "clip", id }), stagedThumbKey(id)],
        "failed staged upload",
      )
      await markUploadFailed(row.authorId, id, "Upload failed")
      return success(c)
    },
  )
