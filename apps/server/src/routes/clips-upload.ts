import { zValidator } from "@hono/zod-validator"
import { eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { nanoid } from "nanoid"

import { user } from "@workspace/db/auth-schema"
import { clip, clipMention, game } from "@workspace/db/schema"

import { getAuth } from "../auth"
import { db } from "../db"
import { selectClipById } from "../lib/clip-select"
import { configStore } from "../lib/config-store"
import { requireSession } from "../lib/require-session"
import { ENCODE_JOB, getBoss } from "../queue"
import { cancelEncode } from "../queue/encode-worker"
import { clipAssetKey, storage } from "../storage"
import { IdParam, InitiateBody, UpdateBody } from "./clips-helpers"

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
      const storageKey = clipAssetKey(clipId, "source")
      const thumbKey = clipAssetKey(clipId, "thumb")

      const privacy = body.privacy === "private" ? "private" : body.privacy

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.id, body.gameId))
        .limit(1)
      if (!gameRow) {
        return c.json({ error: "Unknown game" }, 400)
      }

      const mentionedIds = body.mentionedUserIds
        ? await resolveMentionIds(body.mentionedUserIds, viewerId)
        : []

      await db.insert(clip).values({
        id: clipId,
        slug,
        authorId: viewerId,
        title: body.title,
        description: body.description ?? null,
        // Legacy `game` text column stays null on new uploads — the
        // mapped gameId below is the canonical reference.
        game: null,
        gameId: body.gameId,
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
        await db.insert(clipMention).values(
          mentionedIds.map((mentionedUserId) => ({
            clipId,
            mentionedUserId,
          }))
        )
      }

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
        return c.json({ error: "Upload bytes are missing" }, 400)
      }

      // Client-captured thumbnails are required — the encode worker
      // reuses the existing keys instead of shelling out to ffmpeg.
      if (row.thumbKey) {
        const thumbResolved = await storage.resolve(row.thumbKey)
        if (!thumbResolved) {
          return c.json({ error: "Thumbnail bytes are missing" }, 400)
        }
      }

      await db
        .update(clip)
        .set({
          status: "uploaded",
          sizeBytes: resolved.size,
          updatedAt: new Date(),
        })
        .where(eq(clip.id, id))

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

    await cancelEncode(id)

    const keys = [
      row.storageKey,
      clipAssetKey(id, "video"),
      ...row.variants.map((variant) => variant.storageKey),
      row.thumbKey ?? clipAssetKey(id, "thumb"),
    ]
    for (const key of keys) {
      try {
        await storage.delete(key)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[clips] failed to delete ${key}:`, err)
      }
    }

    await db.delete(clip).where(eq(clip.id, id))
    return c.json({ deleted: true })
  })
