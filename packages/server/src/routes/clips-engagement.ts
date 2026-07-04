import { clip, clipLike, clipView } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { applyViewerCookie, resolveViewer } from "@alloy/server/auth/viewer-key"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { db } from "@alloy/server/db/index"
import {
  booleanFlag,
  likeState,
  noContent,
} from "@alloy/server/runtime/http-response"
import { and, eq, type SQL, sql } from "drizzle-orm"
import { Hono } from "hono"

import { IdParam } from "./clips-helpers"
import { zValidator } from "./validation"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function applyLikeCountDelta(
  tx: Tx,
  clipId: string,
  delta: SQL,
): Promise<number> {
  const [row] = await tx
    .update(clip)
    .set({ like_count: delta })
    .where(eq(clip.id, clipId))
    .returning({ likeCount: clip.like_count })
  if (!row) throw new Error("Clip not found while updating like count.")
  return row.likeCount
}

async function readLikeCount(tx: Tx, clipId: string): Promise<number> {
  const [row] = await tx
    .select({ likeCount: clip.like_count })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  if (!row) throw new Error("Clip not found while reading like count.")
  return row.likeCount
}

export const clipsEngagementRoutes = new Hono()
  .get("/:id/like", requireSession, zValidator("param", IdParam), async (c) => {
    const viewerId = c.var.viewerId
    const { id } = c.req.valid("param")
    const target = await resolveClipAccess({
      id,
      c,
      policy: "engagement",
    })
    if (!target.accessible) return clipAccessResponse(c, target)

    const [row] = await db
      .select({ clipId: clipLike.clip_id })
      .from(clipLike)
      .where(and(eq(clipLike.clip_id, id), eq(clipLike.user_id, viewerId)))
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
        c,
        policy: "engagement",
      })
      if (!target.accessible) return clipAccessResponse(c, target)

      const likeCount = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(clipLike)
          .values({ clip_id: id, user_id: viewerId })
          .onConflictDoNothing()
          .returning({ clipId: clipLike.clip_id })
        if (inserted.length > 0) {
          return applyLikeCountDelta(tx, id, sql`${clip.like_count} + 1`)
        }
        return readLikeCount(tx, id)
      })

      return likeState(c, true, likeCount)
    },
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
        c,
        policy: "engagement",
      })
      if (!target.accessible) return clipAccessResponse(c, target)

      const likeCount = await db.transaction(async (tx) => {
        const removed = await tx
          .delete(clipLike)
          .where(and(eq(clipLike.clip_id, id), eq(clipLike.user_id, viewerId)))
          .returning({ clipId: clipLike.clip_id })
        if (removed.length > 0) {
          return applyLikeCountDelta(
            tx,
            id,
            sql`GREATEST(0, ${clip.like_count} - 1)`,
          )
        }
        return readLikeCount(tx, id)
      })

      return likeState(c, false, likeCount)
    },
  )
  .post("/:id/view", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const target = await resolveClipAccess({
      id,
      c,
      policy: "engagement",
    })
    if (!target.accessible) return clipAccessResponse(c, target)

    const viewer = await resolveViewer(c)

    const inserted = await db
      .insert(clipView)
      .values({
        clip_id: id,
        viewer_key: viewer.viewerKey,
        user_id: viewer.userId,
      })
      .onConflictDoNothing()
      .returning({ clipId: clipView.clip_id })
    if (inserted.length > 0) {
      await db
        .update(clip)
        .set({ view_count: sql`${clip.view_count} + 1` })
        .where(eq(clip.id, id))
    }

    applyViewerCookie(c, viewer.cookieToSet)

    return noContent(c)
  })
