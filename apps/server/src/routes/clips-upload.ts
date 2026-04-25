import { zValidator } from "@hono/zod-validator"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Hono } from "hono"
import { nanoid } from "nanoid"

import { user } from "@workspace/db/auth-schema"
import { clip, clipMention, game } from "@workspace/db/schema"

import { getAuth } from "../auth"
import { db } from "../db"
import { publishClipUpsert } from "../lib/clip-events"
import { deleteClipRowAndAssets } from "../lib/clip-delete"
import { selectClipById } from "../lib/clip-select"
import { configStore } from "../lib/config-store"
import { createNotification } from "../lib/notifications"
import { requireSession } from "../lib/require-session"
import { selectSourceStorageUsedBytes } from "../lib/storage-quota"
import { isConfigured as isSteamGridDBConfigured } from "../lib/steamgriddb"
import { ENCODE_JOB, getBoss } from "../queue"
import { clipAssetKey, clipSourceAssetKey, storage } from "../storage"
import { IdParam, InitiateBody, UpdateBody } from "./clips-helpers"

type InitiateQuotaResult =
  | { ok: true }
  | { ok: false; usedBytes: number; quotaBytes: number }

async function resolveMentionIds(
  rawIds: ReadonlyArray<string>,
  authorId: string
): Promise<string[]> {
  const deduped = [...new Set(rawIds)].filter((id) => id !== authorId)
  if (deduped.length === 0) return []
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.id, deduped))
  return rows.map((row) => row.id)
}

async function markUploadFailed(
  authorId: string,
  clipId: string,
  reason: string
): Promise<void> {
  await db
    .update(clip)
    .set({
      status: "failed",
      failureReason: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
  void publishClipUpsert(authorId, clipId)
  void createNotification({
    recipientId: authorId,
    type: "clip_upload_failed",
    clipId,
  })
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
      const storageKey = clipSourceAssetKey(clipId, body.contentType)
      const thumbKey = clipAssetKey(clipId, "thumb")

      const privacy = body.privacy === "private" ? "private" : body.privacy
      const gameId = body.gameId

      if (!isSteamGridDBConfigured()) {
        return c.json({ error: "SteamGridDB is not configured" }, 400)
      }

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.id, gameId))
        .limit(1)
      if (!gameRow) {
        return c.json({ error: "Unknown game" }, 400)
      }

      const mentionedIds = body.mentionedUserIds
        ? await resolveMentionIds(body.mentionedUserIds, viewerId)
        : []

      const quotaResult = await db.transaction<InitiateQuotaResult>(
        async (tx) => {
          await tx.execute(
            sql`select "id" from "user" where "id" = ${viewerId} for update`
          )
          const [quotaRow] = await tx
            .select({ storageQuotaBytes: user.storageQuotaBytes })
            .from(user)
            .where(eq(user.id, viewerId))
            .limit(1)

          const quotaBytes = quotaRow?.storageQuotaBytes ?? null
          const usedBytes = await selectSourceStorageUsedBytes(tx, viewerId)
          if (quotaBytes !== null && usedBytes + body.sizeBytes > quotaBytes) {
            return { ok: false, usedBytes, quotaBytes }
          }

          await tx.insert(clip).values({
            id: clipId,
            slug,
            authorId: viewerId,
            title: body.title,
            description: body.description ?? null,
            // Legacy `game` text column stays null on new uploads — the
            // mapped gameId below is the canonical reference.
            game: null,
            gameId,
            privacy,
            storageKey,
            contentType: body.contentType,
            sizeBytes: body.sizeBytes,
            thumbKey,
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

      // Fire-and-forget: the clip is now visible in the queue as pending.
      void publishClipUpsert(viewerId, clipId)

      const expiresInSec = configStore.get("limits").uploadTtlSec
      const [ticket, thumbTicket] = await Promise.all([
        storage.mintUploadUrl({
          key: storageKey,
          contentType: body.contentType,
          maxBytes: body.sizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId,
        }),
        storage.mintUploadUrl({
          key: thumbKey,
          contentType: "image/jpeg",
          maxBytes: body.thumbSizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId,
        }),
      ])

      return c.json({ clipId, slug, ticket, thumbTicket })
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
      if (row.authorId !== viewerId) {
        return c.json({ error: "Forbidden" }, 403)
      }
      if (row.status !== "pending") {
        return c.json({ error: `Clip is already ${row.status}` }, 409)
      }

      const resolved = await storage.resolve(row.storageKey)
      if (!resolved) {
        await markUploadFailed(row.authorId, id, "Upload bytes are missing")
        return c.json({ error: "Upload bytes are missing" }, 400)
      }

      const declaredSize = row.sizeBytes ?? 0
      if (declaredSize > 0 && resolved.size > declaredSize * 1.05) {
        await storage.delete(row.storageKey).catch(() => undefined)
        if (row.thumbKey) {
          await storage.delete(row.thumbKey).catch(() => undefined)
        }
        await markUploadFailed(
          row.authorId,
          id,
          "Upload exceeded declared size"
        )
        return c.json({ error: "Upload exceeded declared size" }, 413)
      }

      // Client-captured thumbnails are required — the encode worker
      // reuses the existing keys instead of shelling out to ffmpeg.
      if (row.thumbKey) {
        const thumbResolved = await storage.resolve(row.thumbKey)
        if (!thumbResolved) {
          await markUploadFailed(
            row.authorId,
            id,
            "Thumbnail bytes are missing"
          )
          return c.json({ error: "Thumbnail bytes are missing" }, 400)
        }
      }

      const quotaResult = await db.transaction<InitiateQuotaResult>(
        async (tx) => {
          await tx.execute(
            sql`select "id" from "user" where "id" = ${viewerId} for update`
          )
          const [quotaRow] = await tx
            .select({ storageQuotaBytes: user.storageQuotaBytes })
            .from(user)
            .where(eq(user.id, viewerId))
            .limit(1)
          const quotaBytes = quotaRow?.storageQuotaBytes ?? null
          const usedBytes = await selectSourceStorageUsedBytes(tx, viewerId)
          const previousSize = row.sizeBytes ?? 0
          if (
            quotaBytes !== null &&
            usedBytes - previousSize + resolved.size > quotaBytes
          ) {
            return { ok: false, usedBytes, quotaBytes }
          }
          return { ok: true }
        }
      )
      if (!quotaResult.ok) {
        await storage.delete(row.storageKey).catch(() => undefined)
        if (row.thumbKey) {
          await storage.delete(row.thumbKey).catch(() => undefined)
        }
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
          status: "uploaded",
          sizeBytes: resolved.size,
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

      const boss = await getBoss()
      await boss.send(ENCODE_JOB, { clipId: id })

      const updated = await selectClipById(id)
      return c.json(updated)
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

      const session = await getAuth().api.getSession({
        headers: c.req.raw.headers,
      })
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
        if (!gameRow) {
          return c.json({ error: "Unknown game" }, 400)
        }
        patch.gameId = body.gameId
        // Clear the legacy text column on any mapped change — the
        // new `gameId` is now the authoritative reference.
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

      // Publish to the clip's owner, not `viewerId` — admins editing
      // another user's clip shouldn't emit on the admin's queue channel.
      void publishClipUpsert(row.authorId, id)

      const updated = await selectClipById(id)
      return c.json(updated)
    }
  )

  .delete("/:id", requireSession, zValidator("param", IdParam), async (c) => {
    const viewerId = c.var.viewerId
    const { id } = c.req.valid("param")

    const session = await getAuth().api.getSession({
      headers: c.req.raw.headers,
    })
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
