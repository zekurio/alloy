import { zValidator } from "./validation"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"

import { clip, clipMention, clipUploadTicket, game } from "@workspace/db/schema"
import { logger } from "@workspace/logging"

import { db } from "../db"
import { publishClipUpsert } from "../clips/events"
import { deleteClipRowAndAssets } from "../clips/delete"
import { configStore } from "../config/store"
import { requireSession } from "../auth/require-session"
import {
  badRequest,
  conflict,
  deleted,
  gone,
  serviceUnavailable,
  success,
} from "../runtime/http-response"
import { isConfigured as isSteamGridDBConfigured } from "../games/steamgriddb"
import { enqueueEncode } from "../queue"
import {
  clipScratchUploadKey,
  deleteScratchUpload,
  mintScratchUploadUrl,
  scratchUploadPath,
} from "../uploads/scratch"
import { IdParam, InitiateBody, UpdateBody } from "./clips-helpers"
import {
  assertUsableUploadTicket,
  createUploadTickets,
  type InitiateQuotaResult,
  markUploadFailed,
  resolveMentionIds,
  selectLockedQuotaState,
} from "./clips-upload-helpers"
import {
  selectClipForMutation,
  updatedClipResponse,
} from "./clips-upload-access"

async function cleanupFailedInitiate(
  clipId: string,
  uploadKey: string,
): Promise<void> {
  try {
    await db.delete(clip).where(eq(clip.id, clipId))
  } catch (err) {
    logger.warn(
      `[clips/upload] failed to delete clip ${clipId} after initiate failure:`,
      err,
    )
  }

  try {
    await deleteScratchUpload(uploadKey)
  } catch (err) {
    logger.warn(
      `[clips/upload] failed to delete scratch upload ${uploadKey} after initiate failure:`,
      err,
    )
  }
}

async function selectVideoUploadTicketStorageKey(
  clipId: string,
): Promise<string | null> {
  const [ticketRow] = await db
    .select({ storageKey: clipUploadTicket.storageKey })
    .from(clipUploadTicket)
    .where(
      and(
        eq(clipUploadTicket.clipId, clipId),
        eq(clipUploadTicket.role, "video"),
      ),
    )
    .limit(1)
  return ticketRow?.storageKey ?? null
}

export const clipsUploadRoutes = new Hono()
  .post(
    "/initiate",
    requireSession,
    zValidator("json", InitiateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const body = c.req.valid("json")

      const clipId = crypto.randomUUID()
      const uploadKey = clipScratchUploadKey(clipId, body.contentType)
      const privacy = body.privacy === "private" ? "private" : body.privacy

      if (!isSteamGridDBConfigured()) {
        return serviceUnavailable(c, "SteamGridDB is not configured")
      }

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.id, body.gameId))
        .limit(1)
      if (!gameRow) return badRequest(c, "Unknown game")

      const mentionedIds = body.mentionedUserIds
        ? await resolveMentionIds(body.mentionedUserIds, viewerId)
        : []

      const quotaResult = await db.transaction<InitiateQuotaResult>(
        async (tx) => {
          const { quotaBytes, usedBytes } = await selectLockedQuotaState(
            tx,
            viewerId,
          )
          if (quotaBytes !== null && usedBytes + body.sizeBytes > quotaBytes) {
            return { ok: false, usedBytes, quotaBytes }
          }

          await tx.insert(clip).values({
            id: clipId,
            authorId: viewerId,
            title: body.title,
            description: body.description ?? null,
            game: null,
            gameId: body.gameId,
            privacy,
            sourceContentType: body.contentType,
            sourceSizeBytes: body.sizeBytes,
            trimStartMs: body.trimStartMs ?? null,
            trimEndMs: body.trimEndMs ?? null,
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
          clipId,
          videoKey: uploadKey,
          videoContentType: body.contentType,
          videoBytes: body.sizeBytes,
          expiresAt,
        })
        const ticket = await mintScratchUploadUrl({
          key: uploadKey,
          contentType: body.contentType,
          maxBytes: body.sizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId,
        })
        return c.json({ clipId, ticket })
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

      const storageKey = await selectVideoUploadTicketStorageKey(id)
      const sourceContentType = row.sourceContentType
      const sourceSizeBytes = row.sourceSizeBytes
      if (!storageKey || !sourceContentType || sourceSizeBytes == null) {
        await markUploadFailed(row.authorId, id, "Upload ticket missing")
        return badRequest(c, "Upload ticket missing")
      }

      const videoTicketOk = await assertUsableUploadTicket({
        clipId: id,
        storageKey,
        contentType: sourceContentType,
        expectedBytes: sourceSizeBytes,
        role: "video",
      })
      if (!videoTicketOk) {
        await deleteScratchUpload(storageKey)
        await markUploadFailed(row.authorId, id, "Upload ticket expired")
        return gone(c, "Upload ticket expired")
      }

      const uploadStat = await Deno.stat(scratchUploadPath(storageKey)).catch(
        (err) => {
          if (err instanceof Deno.errors.NotFound) return null
          throw err
        },
      )
      if (!uploadStat?.isFile) {
        await deleteScratchUpload(storageKey)
        await markUploadFailed(row.authorId, id, "Upload bytes are missing")
        return badRequest(c, "Upload bytes are missing")
      }

      if (uploadStat.size !== sourceSizeBytes) {
        await deleteScratchUpload(storageKey)
        await markUploadFailed(
          row.authorId,
          id,
          "Upload size did not match declared size",
        )
        return badRequest(c, "Upload size did not match declared size")
      }

      const quotaResult = await db.transaction<InitiateQuotaResult>(
        async (tx) => {
          const { quotaBytes, usedBytes } = await selectLockedQuotaState(
            tx,
            viewerId,
          )
          if (
            quotaBytes !== null &&
            usedBytes - sourceSizeBytes + uploadStat.size > quotaBytes
          ) {
            return { ok: false, usedBytes, quotaBytes }
          }
          return { ok: true }
        },
      )
      if (!quotaResult.ok) {
        await deleteScratchUpload(storageKey)
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

      const [transitioned] = await db
        .update(clip)
        .set({
          status: "processing",
          sourceSizeBytes: uploadStat.size,
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
      enqueueEncode(id)

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

      await deleteScratchUpload(await selectVideoUploadTicketStorageKey(id))
      await markUploadFailed(row.authorId, id, "Upload failed")
      return success(c)
    },
  )
  .patch(
    "/:id",
    requireSession,
    zValidator("param", IdParam),
    zValidator("json", UpdateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const access = await selectClipForMutation(c, {
        id,
        viewerId,
        allowAdmin: true,
      })
      if ("response" in access) return access.response
      const row = access.row

      const patch: Partial<typeof clip.$inferInsert> = {
        updatedAt: new Date(),
      }
      if (body.title !== undefined) patch.title = body.title
      if (body.description !== undefined) {
        patch.description = body.description === "" ? null : body.description
      }
      if (body.gameId !== undefined) {
        const [gameRow] = await db
          .select({ id: game.id })
          .from(game)
          .where(eq(game.id, body.gameId))
          .limit(1)
        if (!gameRow) return badRequest(c, "Unknown game")
        patch.gameId = body.gameId
        patch.game = null
      }
      if (body.privacy !== undefined) patch.privacy = body.privacy

      await db.update(clip).set(patch).where(eq(clip.id, id))

      if (body.mentionedUserIds !== undefined) {
        const mentionedIds = await resolveMentionIds(
          body.mentionedUserIds,
          row.authorId,
        )
        await db.delete(clipMention).where(eq(clipMention.clipId, id))
        if (mentionedIds.length > 0) {
          await db.insert(clipMention).values(
            mentionedIds.map((mentionedUserId) => ({
              clipId: id,
              mentionedUserId,
            })),
          )
        }
      }

      void publishClipUpsert(row.authorId, id)

      return updatedClipResponse(c, id)
    },
  )
  .delete("/:id", requireSession, zValidator("param", IdParam), async (c) => {
    const viewerId = c.var.viewerId
    const { id } = c.req.valid("param")

    const access = await selectClipForMutation(c, {
      id,
      viewerId,
      allowAdmin: true,
    })
    if ("response" in access) return access.response
    const row = access.row

    await deleteClipRowAndAssets(row)
    return deleted(c)
  })
