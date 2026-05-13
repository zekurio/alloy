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
  clipAssetKey,
  clipStagingThumbKey,
  clipStagingVideoKey,
  storage,
} from "../storage"
import { validateImageBytes } from "../media/image-validation"
import { IdParam, InitiateBody, UpdateBody } from "./clips-helpers"
import {
  assertUsableUploadTicket,
  createUploadTickets,
  markUploadFailed,
  resolveMentionIds,
  selectLockedQuotaState,
  type InitiateQuotaResult,
} from "./clips-upload-helpers"

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
      const storageKey = clipStagingVideoKey(clipId, body.contentType)
      const thumbKey = clipStagingThumbKey(clipId)

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
      const expiresAt = new Date(Date.now() + expiresInSec * 1000)
      let ticket: Awaited<ReturnType<typeof storage.mintUploadUrl>>
      let thumbTicket: Awaited<ReturnType<typeof storage.mintUploadUrl>>
      try {
        await createUploadTickets({
          clipId,
          videoKey: storageKey,
          videoContentType: body.contentType,
          videoBytes: body.sizeBytes,
          thumbKey,
          thumbBytes: body.thumbSizeBytes,
          expiresAt,
        })
        ;[ticket, thumbTicket] = await Promise.all([
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
      } catch (err) {
        await db
          .delete(clip)
          .where(eq(clip.id, clipId))
          .catch(() => undefined)
        await storage.delete(storageKey).catch(() => undefined)
        await storage.delete(thumbKey).catch(() => undefined)
        throw err
      }

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
      const videoTicketOk = await assertUsableUploadTicket({
        clipId: id,
        storageKey: row.storageKey,
        contentType: row.contentType,
        expectedBytes: row.sizeBytes ?? 0,
        role: "video",
      })
      if (!videoTicketOk) {
        await deleteUploadAssets(row.storageKey, row.thumbKey)
        await markUploadFailed(row.authorId, id, "Upload ticket expired")
        return c.json({ error: "Upload ticket expired" }, 410)
      }

      const resolved = await storage.resolve(row.storageKey)
      if (!resolved) {
        await deleteUploadAssets(row.storageKey, row.thumbKey)
        await markUploadFailed(row.authorId, id, "Upload bytes are missing")
        return c.json({ error: "Upload bytes are missing" }, 400)
      }

      const declaredSize = row.sizeBytes ?? 0
      if (declaredSize > 0 && resolved.size !== declaredSize) {
        await deleteUploadAssets(row.storageKey, row.thumbKey)
        await markUploadFailed(
          row.authorId,
          id,
          "Upload size did not match declared size"
        )
        return c.json({ error: "Upload size did not match declared size" }, 400)
      }

      if (resolved.contentType !== row.contentType) {
        await deleteUploadAssets(row.storageKey, row.thumbKey)
        await markUploadFailed(
          row.authorId,
          id,
          "Upload content type did not match declared type"
        )
        return c.json(
          { error: "Upload content type did not match declared type" },
          400
        )
      }

      // Client-captured thumbnails are required — the encode worker
      // reuses the existing keys instead of shelling out to ffmpeg.
      if (row.thumbKey) {
        const thumbResolved = await storage.resolve(row.thumbKey)
        if (!thumbResolved) {
          await deleteUploadAssets(row.storageKey, row.thumbKey)
          await markUploadFailed(
            row.authorId,
            id,
            "Thumbnail bytes are missing"
          )
          return c.json({ error: "Thumbnail bytes are missing" }, 400)
        }
        const thumbTicketOk = await assertUsableUploadTicket({
          clipId: id,
          storageKey: row.thumbKey,
          contentType: "image/jpeg",
          expectedBytes: thumbResolved.size,
          role: "thumbnail",
        })
        if (!thumbTicketOk) {
          await deleteUploadAssets(row.storageKey, row.thumbKey)
          await markUploadFailed(row.authorId, id, "Thumbnail ticket expired")
          return c.json({ error: "Thumbnail ticket expired" }, 410)
        }
        const thumbBytes = await readResolvedObject(thumbResolved)
        const thumbValidation = validateImageBytes(thumbBytes, "image/jpeg")
        if (!thumbValidation.ok) {
          await deleteUploadAssets(row.storageKey, row.thumbKey)
          await markUploadFailed(row.authorId, id, thumbValidation.error)
          return c.json({ error: thumbValidation.error }, 400)
        }
      }
      const canonicalThumbKey = clipAssetKey(id, "thumb")

      const quotaResult = await db.transaction<InitiateQuotaResult>(
        async (tx) => {
          const { quotaBytes, usedBytes } = await selectLockedQuotaState(
            tx,
            viewerId
          )
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
        await deleteUploadAssets(row.storageKey, row.thumbKey)
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

      if (row.thumbKey && row.thumbKey !== canonicalThumbKey) {
        try {
          await storage.copy({
            fromKey: row.thumbKey,
            toKey: canonicalThumbKey,
            contentType: "image/jpeg",
          })
        } catch (err) {
          const [current] = await db
            .select({ status: clip.status })
            .from(clip)
            .where(eq(clip.id, id))
            .limit(1)
          if (current?.status !== "pending") {
            return c.json({ error: "Clip is already being finalized" }, 409)
          }
          throw err
        }
      }

      const [transitioned] = await db.transaction(async (tx) => {
        const now = new Date()
        await tx
          .update(clipUploadTicket)
          .set({ usedAt: now })
          .where(
            and(
              eq(clipUploadTicket.clipId, id),
              eq(clipUploadTicket.storageKey, row.storageKey),
              eq(clipUploadTicket.role, "video")
            )
          )
        if (row.thumbKey) {
          await tx
            .update(clipUploadTicket)
            .set({ usedAt: now })
            .where(
              and(
                eq(clipUploadTicket.clipId, id),
                eq(clipUploadTicket.storageKey, row.thumbKey),
                eq(clipUploadTicket.role, "thumbnail")
              )
            )
        }

        return tx
          .update(clip)
          .set({
            status: "uploaded",
            sizeBytes: resolved.size,
            thumbKey: canonicalThumbKey,
            updatedAt: now,
          })
          .where(
            and(
              eq(clip.id, id),
              eq(clip.authorId, viewerId),
              eq(clip.status, "pending")
            )
          )
          .returning({ id: clip.id })
      })
      if (!transitioned) {
        return c.json({ error: "Clip is already being finalized" }, 409)
      }
      if (row.thumbKey && row.thumbKey !== canonicalThumbKey) {
        await storage.delete(row.thumbKey).catch(() => undefined)
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
      if (row.authorId !== viewerId) {
        return c.json({ error: "Forbidden" }, 403)
      }
      if (row.status !== "pending" && row.status !== "uploaded") {
        return c.json({ error: `Clip is already ${row.status}` }, 409)
      }

      await deleteUploadAssets(row.storageKey, row.thumbKey)
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

async function readResolvedObject(resolved: {
  stream: () => NodeJS.ReadableStream
}): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of resolved.stream()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function deleteUploadAssets(
  storageKey: string,
  thumbKey: string | null
): Promise<void> {
  await storage.delete(storageKey).catch(() => undefined)
  if (thumbKey) {
    await storage.delete(thumbKey).catch(() => undefined)
  }
}
