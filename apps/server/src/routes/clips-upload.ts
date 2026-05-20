import { zValidator } from "@hono/zod-validator"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { nanoid } from "nanoid"

import { clip, clipMention, clipUploadTicket, game } from "@workspace/db/schema"

import { db } from "../db"
import { getSession } from "../auth/session"
import { publishClipUpsert } from "../clips/events"
import { deleteClipRowAndAssets } from "../clips/delete"
import { selectClipById, toPublicClipRow } from "../clips/select"
import { configStore } from "../config/store"
import { requireSession } from "../auth/require-session"
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
  markUploadFailed,
  resolveMentionIds,
  selectLockedQuotaState,
  type InitiateQuotaResult,
} from "./clips-upload-helpers"

async function selectVideoUploadTicketStorageKey(
  clipId: string
): Promise<string | null> {
  const [ticketRow] = await db
    .select({ storageKey: clipUploadTicket.storageKey })
    .from(clipUploadTicket)
    .where(
      and(
        eq(clipUploadTicket.clipId, clipId),
        eq(clipUploadTicket.role, "video")
      )
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
      const slug = nanoid(10)
      const uploadKey = clipScratchUploadKey(clipId, body.contentType)
      const privacy = body.privacy === "private" ? "private" : body.privacy

      if (!isSteamGridDBConfigured()) {
        return c.json({ error: "SteamGridDB is not configured" }, 400)
      }

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.id, body.gameId))
        .limit(1)
      if (!gameRow) return c.json({ error: "Unknown game" }, 400)

      const mentionedIds = body.mentionedUserIds
        ? await resolveMentionIds(body.mentionedUserIds, viewerId)
        : []

      const quotaResult = await db.transaction<InitiateQuotaResult>(
        async (tx) => {
          const { quotaBytes, usedBytes } = await selectLockedQuotaState(
            tx,
            viewerId
          )
          if (quotaBytes !== null && usedBytes + body.sizeBytes > quotaBytes) {
            return { ok: false, usedBytes, quotaBytes }
          }

          await tx.insert(clip).values({
            id: clipId,
            slug,
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
              }))
            )
          }

          return { ok: true }
        }
      )

      if (!quotaResult.ok) {
        return c.json(
          {
            error: "Storage quota exceeded",
            usedBytes: quotaResult.usedBytes,
            quotaBytes: quotaResult.quotaBytes,
          },
          413
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
        return c.json({ clipId, slug, ticket })
      } catch (err) {
        await db
          .delete(clip)
          .where(eq(clip.id, clipId))
          .catch(() => undefined)
        await deleteScratchUpload(uploadKey).catch(() => undefined)
        throw err
      }
    }
  )

  .post(
    "/:id/finalize",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)
      if (row.authorId !== viewerId) return c.json({ error: "Forbidden" }, 403)
      if (row.status !== "pending") {
        return c.json({ error: `Clip is already ${row.status}` }, 409)
      }

      const storageKey = await selectVideoUploadTicketStorageKey(id)
      if (
        !storageKey ||
        !row.sourceContentType ||
        row.sourceSizeBytes == null
      ) {
        await markUploadFailed(row.authorId, id, "Upload ticket missing")
        return c.json({ error: "Upload ticket missing" }, 400)
      }

      const videoTicketOk = await assertUsableUploadTicket({
        clipId: id,
        storageKey,
        contentType: row.sourceContentType,
        expectedBytes: row.sourceSizeBytes,
        role: "video",
      })
      if (!videoTicketOk) {
        await deleteScratchUpload(storageKey)
        await markUploadFailed(row.authorId, id, "Upload ticket expired")
        return c.json({ error: "Upload ticket expired" }, 410)
      }

      const uploadStat = await Deno.stat(scratchUploadPath(storageKey)).catch(
        (err) => {
          if (err instanceof Deno.errors.NotFound) return null
          throw err
        }
      )
      if (!uploadStat?.isFile) {
        await deleteScratchUpload(storageKey)
        await markUploadFailed(row.authorId, id, "Upload bytes are missing")
        return c.json({ error: "Upload bytes are missing" }, 400)
      }

      if (uploadStat.size !== row.sourceSizeBytes) {
        await deleteScratchUpload(storageKey)
        await markUploadFailed(
          row.authorId,
          id,
          "Upload size did not match declared size"
        )
        return c.json({ error: "Upload size did not match declared size" }, 400)
      }

      const quotaResult = await db.transaction<InitiateQuotaResult>(
        async (tx) => {
          const { quotaBytes, usedBytes } = await selectLockedQuotaState(
            tx,
            viewerId
          )
          if (
            quotaBytes !== null &&
            usedBytes - row.sourceSizeBytes! + uploadStat.size > quotaBytes
          ) {
            return { ok: false, usedBytes, quotaBytes }
          }
          return { ok: true }
        }
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
          413
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
            eq(clip.status, "pending")
          )
        )
        .returning({ id: clip.id })
      if (!transitioned) {
        return c.json({ error: "Clip is already being finalized" }, 409)
      }

      void publishClipUpsert(viewerId, id)
      enqueueEncode(id)

      const updated = await selectClipById(id)
      return c.json(updated ? toPublicClipRow(updated) : null)
    }
  )

  .post(
    "/:id/fail",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)
      if (row.authorId !== viewerId) return c.json({ error: "Forbidden" }, 403)
      if (row.status !== "pending" && row.status !== "processing") {
        return c.json({ error: `Clip is already ${row.status}` }, 409)
      }

      await deleteScratchUpload(await selectVideoUploadTicketStorageKey(id))
      await markUploadFailed(row.authorId, id, "Upload failed")
      return c.json({ success: true })
    }
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

      const session = await getSession(c)
      const isAdmin =
        (session?.user as { role?: string | null } | undefined)?.role ===
        "admin"

      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)
      if (row.authorId !== viewerId && !isAdmin) {
        return c.json({ error: "Forbidden" }, 403)
      }

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
        if (!gameRow) return c.json({ error: "Unknown game" }, 400)
        patch.gameId = body.gameId
        patch.game = null
      }
      if (body.privacy !== undefined) patch.privacy = body.privacy

      await db.update(clip).set(patch).where(eq(clip.id, id))

      if (body.mentionedUserIds !== undefined) {
        const mentionedIds = await resolveMentionIds(
          body.mentionedUserIds,
          row.authorId
        )
        await db.delete(clipMention).where(eq(clipMention.clipId, id))
        if (mentionedIds.length > 0) {
          await db.insert(clipMention).values(
            mentionedIds.map((mentionedUserId) => ({
              clipId: id,
              mentionedUserId,
            }))
          )
        }
      }

      void publishClipUpsert(row.authorId, id)

      const updated = await selectClipById(id)
      return c.json(updated ? toPublicClipRow(updated) : null)
    }
  )

  .delete("/:id", requireSession, zValidator("param", IdParam), async (c) => {
    const viewerId = c.var.viewerId
    const { id } = c.req.valid("param")

    const session = await getSession(c)
    const isAdmin =
      (session?.user as { role?: string | null } | undefined)?.role === "admin"

    const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
    if (!row) return c.json({ error: "Not found" }, 404)
    if (row.authorId !== viewerId && !isAdmin) {
      return c.json({ error: "Forbidden" }, 403)
    }

    await deleteClipRowAndAssets(row)
    return c.json({ deleted: true })
  })
