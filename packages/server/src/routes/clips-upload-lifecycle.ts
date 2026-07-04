import { normalizeTags } from "@alloy/contracts"
import { clip, clipMention, clipTag } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { resolveTrimRange } from "@alloy/server/clips/trim-range"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { getGameRefById } from "@alloy/server/games/ref"
import {
  enqueueClipEncode,
  wakeClipEncodeQueue,
} from "@alloy/server/jobs/kinds/clip-encode"
import {
  badRequest,
  conflict,
  gone,
  success,
} from "@alloy/server/runtime/http-response"
import {
  deleteStagedUpload,
  deleteStagedUploads,
  mintStagedUpload,
  resolveStagedUpload,
  stagedSourceKey,
} from "@alloy/server/uploads/staged"
import {
  assertUsableVideoTicket,
  createUploadTickets,
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
import { zValidator } from "./validation"

const logger = createLogger("clips")

type InitiateTransactionResult =
  | UploadQuotaResult
  | { ok: false; reason: "id-conflict" }

async function cleanupFailedInitiate(
  clipId: string,
  uploads: Array<{
    key: string | null
  }>,
): Promise<void> {
  try {
    await db.delete(clip).where(eq(clip.id, clipId))
  } catch (err) {
    logger.warn(`failed to delete clip ${clipId} after initiate failure:`, err)
  }

  try {
    await deleteStagedUploads(uploads, "initiate failure staged upload")
  } catch (err) {
    logger.warn(
      `failed to delete staged uploads for ${clipId} after initiate failure:`,
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

      const clipId = body.clientClipId ?? crypto.randomUUID()
      const uploadKey = stagedSourceKey(clipId, body.contentType)
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

          return { ok: true }
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
      const sourceContentType = row.source_content_type
      const sourceSizeBytes = row.source_size_bytes
      if (!videoTicketKey || !sourceContentType || sourceSizeBytes == null) {
        await markUploadFailed(row.author_id, id, "Upload ticket missing")
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
        await markUploadFailed(row.author_id, id, "Upload ticket expired")
        return gone(c, "Upload ticket expired")
      }

      const stagedUpload = await resolveStagedUpload(videoTicketKey)
      if (!stagedUpload) {
        await deleteStagedUpload(videoTicketKey)
        await markUploadFailed(row.author_id, id, "Upload bytes are missing")
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
        await deleteStagedUpload(videoTicketKey)
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
        await deleteStagedUpload(videoTicketKey)
        await markUploadFailed(
          row.author_id,
          id,
          "Upload size did not match declared size",
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
        await enqueueClipEncode(id, { trigger: "upload", priority: 10, tx })
        return row
      })
      if (!transitioned) {
        return conflict(c, "Clip is already being finalized")
      }
      wakeClipEncodeQueue()

      void publishClipUpsert(viewerId, id)

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
                }
              : null,
          ),
        ],
        "failed staged upload",
      )
      await markUploadFailed(row.author_id, id, "Upload failed")
      return success(c)
    },
  )
