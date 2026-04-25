import { zValidator } from "@hono/zod-validator"
import { and, eq, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { clip, clipLike, clipView } from "@workspace/db/schema"

import { cache } from "../cache"
import { db } from "../db"
import { requireSession } from "../lib/require-session"
import { applyViewerCookie, resolveViewer } from "../lib/viewer-key"
import {
  IdParam,
  resolveEngagementTarget,
  VIEW_THROTTLE_TTL_SEC,
} from "./clips-helpers"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function applyLikeCountDelta(
  tx: Tx,
  clipId: string,
  delta: SQL,
  fallback: number
): Promise<number> {
  const [row] = await tx
    .update(clip)
    .set({ likeCount: delta })
    .where(eq(clip.id, clipId))
    .returning({ likeCount: clip.likeCount })
  return row?.likeCount ?? fallback
}

async function readLikeCount(
  tx: Tx,
  clipId: string,
  fallback: number
): Promise<number> {
  const [row] = await tx
    .select({ likeCount: clip.likeCount })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  return row?.likeCount ?? fallback
}

export const clipsEngagementRoutes = new Hono()
  .get("/:id/like", requireSession, zValidator("param", IdParam), async (c) => {
    const viewerId = c.var.viewerId
    const { id } = c.req.valid("param")
    const [row] = await db
      .select({ clipId: clipLike.clipId })
      .from(clipLike)
      .where(and(eq(clipLike.clipId, id), eq(clipLike.userId, viewerId)))
      .limit(1)
    return c.json({ liked: row !== undefined })
  })

  .post(
    "/:id/like",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const target = await resolveEngagementTarget(id, c.req.raw.headers)
      if (!target.accessible) return target.response

      const likeCount = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(clipLike)
          .values({ clipId: id, userId: viewerId })
          .onConflictDoNothing()
          .returning({ clipId: clipLike.clipId })
        if (inserted.length > 0) {
          return applyLikeCountDelta(tx, id, sql`${clip.likeCount} + 1`, 0)
        }
        return readLikeCount(tx, id, 0)
      })

      return c.json({ liked: true, likeCount })
    }
  )

  .delete(
    "/:id/like",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const target = await resolveEngagementTarget(id, c.req.raw.headers)
      if (!target.accessible) return target.response

      const likeCount = await db.transaction(async (tx) => {
        const removed = await tx
          .delete(clipLike)
          .where(and(eq(clipLike.clipId, id), eq(clipLike.userId, viewerId)))
          .returning({ clipId: clipLike.clipId })
        if (removed.length > 0) {
          return applyLikeCountDelta(
            tx,
            id,
            sql`GREATEST(0, ${clip.likeCount} - 1)`,
            0
          )
        }
        return readLikeCount(tx, id, target.likeCount)
      })

      return c.json({ liked: false, likeCount })
    }
  )

  .post("/:id/view", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const target = await resolveEngagementTarget(id, c.req.raw.headers)
    if (!target.accessible) return target.response

    const viewer = await resolveViewer(c)

    let fresh = true
    try {
      fresh = await cache.setIfAbsent(
        `view:${id}:${viewer.viewerKey}`,
        VIEW_THROTTLE_TTL_SEC
      )
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[clips] cache setIfAbsent failed for view ${id}:`, err)
    }

    if (fresh) {
      const inserted = await db
        .insert(clipView)
        .values({
          clipId: id,
          viewerKey: viewer.viewerKey,
          userId: viewer.userId,
        })
        .onConflictDoNothing()
        .returning({ clipId: clipView.clipId })
      if (inserted.length > 0) {
        await db
          .update(clip)
          .set({ viewCount: sql`${clip.viewCount} + 1` })
          .where(eq(clip.id, id))
      }
    }

    applyViewerCookie(c, viewer.cookieToSet)

    return c.body(null, 204)
  })
