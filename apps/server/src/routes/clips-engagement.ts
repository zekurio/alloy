import { zValidator } from "./validation"
import { and, eq, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { clip, clipLike, clipView } from "@workspace/db/schema"

import { db } from "../db"
import { clipAccessResponse, resolveClipAccess } from "../clips/access"
import { requireSession } from "../auth/require-session"
import { applyViewerCookie, resolveViewer } from "../auth/viewer-key"
import { booleanFlag, likeState, noContent } from "../runtime/http-response"
import { IdParam } from "./clips-helpers"

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
    const target = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "engagement",
    })
    if (!target.accessible) return clipAccessResponse(c, target)

    const [row] = await db
      .select({ clipId: clipLike.clipId })
      .from(clipLike)
      .where(and(eq(clipLike.clipId, id), eq(clipLike.userId, viewerId)))
      .limit(1)
    return booleanFlag(c, "liked", row !== undefined)
  })

  .post(
    "/:id/like",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const target = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "engagement",
      })
      if (!target.accessible) return clipAccessResponse(c, target)

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

      return likeState(c, true, likeCount)
    }
  )

  .delete(
    "/:id/like",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const target = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "engagement",
      })
      if (!target.accessible) return clipAccessResponse(c, target)

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
        return readLikeCount(tx, id, target.row.likeCount)
      })

      return likeState(c, false, likeCount)
    }
  )

  .post("/:id/view", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const target = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "engagement",
    })
    if (!target.accessible) return clipAccessResponse(c, target)

    const viewer = await resolveViewer(c)

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

    applyViewerCookie(c, viewer.cookieToSet)

    return noContent(c)
  })
