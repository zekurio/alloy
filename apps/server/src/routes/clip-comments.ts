import { zValidator } from "@hono/zod-validator"
import { and, eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import type { CommentRow } from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip, clipComment, clipCommentLike } from "@workspace/db/schema"

import { getAuth } from "../auth"
import { db } from "../db"
import { createNotification } from "../lib/notifications"
import { requireSession } from "../lib/require-session"
import { IdParam, peekViewer, resolveEngagementTarget } from "./clips-helpers"
import {
  CommentIdParam,
  CreateBody,
  ListQuery,
  UpdateBody,
  authorShape,
  listClipComments,
  selectClipAccess,
} from "./clip-comments-helpers"

async function resolveCommentEngagementTarget(
  commentId: string,
  headers: Headers
) {
  const [row] = await db
    .select({ clipId: clipComment.clipId })
    .from(clipComment)
    .where(eq(clipComment.id, commentId))
    .limit(1)
  if (!row) return { accessible: false as const, response: null }
  const target = await resolveEngagementTarget(row.clipId, headers)
  if (!target.accessible) return target
  return { accessible: true as const }
}

export const clipCommentsRoutes = new Hono()
  .get(
    "/:id/comments",
    zValidator("param", IdParam),
    zValidator("query", ListQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { sort } = c.req.valid("query")

      const target = await selectClipAccess(id)
      if (!target) return c.json({ error: "Not found" }, 404)
      const viewer = await peekViewer(c.req.raw.headers)
      const isOwner = viewer?.id === target.authorId
      const isAdmin = viewer?.role === "admin"
      if (target.privacy === "private" && !isOwner && !isAdmin) {
        return c.json({ error: "Not found" }, 404)
      }

      return c.json(
        await listClipComments({
          clipId: id,
          sort,
          viewerId: viewer?.id ?? null,
          clipAuthorId: target.authorId,
        })
      )
    }
  )

  .post(
    "/:id/comments",
    requireSession,
    zValidator("param", IdParam),
    zValidator("json", CreateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const { body, parentId } = c.req.valid("json")

      const target = await resolveEngagementTarget(id, c.req.raw.headers)
      if (!target.accessible) return target.response

      // Replies are single-level: if parent already has a parent, anchor
      // the new reply to the top-level id instead (YouTube-style).
      let resolvedParentId: string | null = null
      if (parentId) {
        const [parent] = await db
          .select({
            id: clipComment.id,
            clipId: clipComment.clipId,
            parentId: clipComment.parentId,
          })
          .from(clipComment)
          .where(eq(clipComment.id, parentId))
          .limit(1)
        if (!parent || parent.clipId !== id) {
          return c.json({ error: "Parent comment not found" }, 404)
        }
        resolvedParentId = parent.parentId ?? parent.id
      }

      const [inserted] = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(clipComment)
          .values({
            clipId: id,
            authorId: viewerId,
            parentId: resolvedParentId,
            body,
          })
          .returning()
        await tx
          .update(clip)
          .set({ commentCount: sql`${clip.commentCount} + 1` })
          .where(eq(clip.id, id))
        return rows
      })
      if (!inserted) return c.json({ error: "Insert failed" }, 500)

      void createNotification({
        recipientId: target.authorId,
        actorId: viewerId,
        type: "clip_comment",
        clipId: id,
        commentId: inserted.id,
      })

      const [authorRow] = await db
        .select(authorShape)
        .from(user)
        .where(eq(user.id, viewerId))
        .limit(1)

      const out: CommentRow = {
        id: inserted.id,
        clipId: inserted.clipId,
        parentId: inserted.parentId,
        body: inserted.body,
        likeCount: inserted.likeCount,
        pinned: false,
        pinnedAt: null,
        likedByViewer: false,
        likedByAuthor: false,
        createdAt: inserted.createdAt.toISOString(),
        editedAt: null,
        author: {
          id: authorRow?.id ?? viewerId,
          username: authorRow?.username ?? "",
          displayUsername: authorRow?.displayUsername ?? "",
          name: authorRow?.name ?? "",
          image: authorRow?.image ?? null,
        },
        replies: [],
      }
      return c.json(out, 201)
    }
  )

  .patch(
    "/comments/:commentId",
    requireSession,
    zValidator("param", CommentIdParam),
    zValidator("json", UpdateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")
      const { body } = c.req.valid("json")

      const [existing] = await db
        .select({ id: clipComment.id, authorId: clipComment.authorId })
        .from(clipComment)
        .where(eq(clipComment.id, commentId))
        .limit(1)
      if (!existing) return c.json({ error: "Not found" }, 404)
      if (existing.authorId !== viewerId) {
        return c.json({ error: "Forbidden" }, 403)
      }

      const [updated] = await db
        .update(clipComment)
        .set({ body, editedAt: new Date() })
        .where(eq(clipComment.id, commentId))
        .returning({
          id: clipComment.id,
          body: clipComment.body,
          editedAt: clipComment.editedAt,
        })
      return c.json({
        id: updated!.id,
        body: updated!.body,
        editedAt: updated!.editedAt?.toISOString() ?? null,
      })
    }
  )

  .delete(
    "/comments/:commentId",
    requireSession,
    zValidator("param", CommentIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")

      const [row] = await db
        .select({
          id: clipComment.id,
          clipId: clipComment.clipId,
          authorId: clipComment.authorId,
          parentId: clipComment.parentId,
        })
        .from(clipComment)
        .where(eq(clipComment.id, commentId))
        .limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)

      const [clipRow] = await db
        .select({ authorId: clip.authorId })
        .from(clip)
        .where(eq(clip.id, row.clipId))
        .limit(1)

      const session = await getAuth().api.getSession({
        headers: c.req.raw.headers,
      })
      const isAdmin =
        (session?.user as { role?: string | null } | undefined)?.role ===
        "admin"
      const isCommentAuthor = row.authorId === viewerId
      const isClipAuthor = clipRow?.authorId === viewerId
      if (!isCommentAuthor && !isClipAuthor && !isAdmin) {
        return c.json({ error: "Forbidden" }, 403)
      }

      await db.transaction(async (tx) => {
        // Count how many rows we're about to delete so commentCount
        // stays in sync. Replies cascade via the self-FK.
        let toDelete = 1
        if (row.parentId === null) {
          const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(clipComment)
            .where(eq(clipComment.parentId, row.id))
          toDelete += count ?? 0
        }
        await tx.delete(clipComment).where(eq(clipComment.id, row.id))
        await tx
          .update(clip)
          .set({
            commentCount: sql`GREATEST(0, ${clip.commentCount} - ${toDelete})`,
          })
          .where(eq(clip.id, row.clipId))
      })

      return c.json({ deleted: true })
    }
  )

  .post(
    "/comments/:commentId/like",
    requireSession,
    zValidator("param", CommentIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")

      const target = await resolveCommentEngagementTarget(
        commentId,
        c.req.raw.headers
      )
      if (!target.accessible) {
        return target.response ?? c.json({ error: "Not found" }, 404)
      }

      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(clipCommentLike)
          .values({ commentId, userId: viewerId })
          .onConflictDoNothing()
          .returning({ commentId: clipCommentLike.commentId })
        if (inserted.length === 0) {
          const [row] = await tx
            .select({
              likeCount: clipComment.likeCount,
              authorId: clipComment.authorId,
              clipId: clipComment.clipId,
              clipAuthorId: clip.authorId,
            })
            .from(clipComment)
            .innerJoin(clip, eq(clipComment.clipId, clip.id))
            .where(eq(clipComment.id, commentId))
            .limit(1)
          return row
            ? { liked: true, likeCount: row.likeCount, inserted: false, row }
            : null
        }
        const [row] = await tx
          .update(clipComment)
          .set({ likeCount: sql`${clipComment.likeCount} + 1` })
          .where(eq(clipComment.id, commentId))
          .returning({
            likeCount: clipComment.likeCount,
            authorId: clipComment.authorId,
            clipId: clipComment.clipId,
          })
        if (!row) return null
        const [clipRow] = await tx
          .select({ authorId: clip.authorId })
          .from(clip)
          .where(eq(clip.id, row.clipId))
          .limit(1)
        return {
          liked: true,
          likeCount: row.likeCount,
          inserted: true,
          row: { ...row, clipAuthorId: clipRow?.authorId ?? null },
        }
      })
      if (!result) return c.json({ error: "Not found" }, 404)
      if (
        result.inserted &&
        result.row.clipAuthorId === viewerId &&
        result.row.authorId !== viewerId
      ) {
        void createNotification({
          recipientId: result.row.authorId,
          actorId: viewerId,
          type: "comment_liked_by_author",
          clipId: result.row.clipId,
          commentId,
        })
      }
      return c.json({ liked: result.liked, likeCount: result.likeCount })
    }
  )

  .delete(
    "/comments/:commentId/like",
    requireSession,
    zValidator("param", CommentIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")

      const target = await resolveCommentEngagementTarget(
        commentId,
        c.req.raw.headers
      )
      if (!target.accessible) {
        return target.response ?? c.json({ error: "Not found" }, 404)
      }

      const result = await db.transaction(async (tx) => {
        const removed = await tx
          .delete(clipCommentLike)
          .where(
            and(
              eq(clipCommentLike.commentId, commentId),
              eq(clipCommentLike.userId, viewerId)
            )
          )
          .returning({ commentId: clipCommentLike.commentId })
        if (removed.length === 0) {
          const [row] = await tx
            .select({ likeCount: clipComment.likeCount })
            .from(clipComment)
            .where(eq(clipComment.id, commentId))
            .limit(1)
          return row ? { liked: false, likeCount: row.likeCount } : null
        }
        const [row] = await tx
          .update(clipComment)
          .set({ likeCount: sql`GREATEST(0, ${clipComment.likeCount} - 1)` })
          .where(eq(clipComment.id, commentId))
          .returning({ likeCount: clipComment.likeCount })
        return row ? { liked: false, likeCount: row.likeCount } : null
      })
      if (!result) return c.json({ error: "Not found" }, 404)
      return c.json(result)
    }
  )

  .post(
    "/comments/:commentId/pin",
    requireSession,
    zValidator("param", CommentIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")

      const [row] = await db
        .select({
          id: clipComment.id,
          clipId: clipComment.clipId,
          authorId: clipComment.authorId,
          parentId: clipComment.parentId,
        })
        .from(clipComment)
        .where(eq(clipComment.id, commentId))
        .limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)
      if (row.parentId !== null) {
        return c.json({ error: "Only top-level comments can be pinned" }, 400)
      }

      const [clipRow] = await db
        .select({ authorId: clip.authorId })
        .from(clip)
        .where(eq(clip.id, row.clipId))
        .limit(1)
      if (!clipRow) return c.json({ error: "Not found" }, 404)
      if (clipRow.authorId !== viewerId) {
        return c.json({ error: "Forbidden" }, 403)
      }

      await db.transaction(async (tx) => {
        // Unpin any existing pin for this clip first — the partial unique
        // index guarantees only one pinnedAt can be non-null at a time.
        await tx
          .update(clipComment)
          .set({ pinnedAt: null })
          .where(
            and(
              eq(clipComment.clipId, row.clipId),
              sql`${clipComment.pinnedAt} IS NOT NULL`
            )
          )
        await tx
          .update(clipComment)
          .set({ pinnedAt: new Date() })
          .where(eq(clipComment.id, commentId))
      })
      void createNotification({
        recipientId: row.authorId,
        actorId: viewerId,
        type: "comment_pinned",
        clipId: row.clipId,
        commentId,
      })
      return c.json({ pinned: true })
    }
  )

  .delete(
    "/comments/:commentId/pin",
    requireSession,
    zValidator("param", CommentIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")

      const [row] = await db
        .select({ id: clipComment.id, clipId: clipComment.clipId })
        .from(clipComment)
        .where(eq(clipComment.id, commentId))
        .limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)

      const [clipRow] = await db
        .select({ authorId: clip.authorId })
        .from(clip)
        .where(eq(clip.id, row.clipId))
        .limit(1)
      if (!clipRow) return c.json({ error: "Not found" }, 404)
      if (clipRow.authorId !== viewerId) {
        return c.json({ error: "Forbidden" }, 403)
      }

      await db
        .update(clipComment)
        .set({ pinnedAt: null })
        .where(eq(clipComment.id, commentId))
      return c.json({ pinned: false })
    }
  )
