import type { CommentRow } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipComment, clipCommentLike } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { db } from "@alloy/server/db/index"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import {
  booleanFlag,
  deleted,
  errorResult,
  forbidden,
  internalServerError,
  invalidCursor,
  likeState,
  notFound,
} from "@alloy/server/runtime/http-response"
import { and, eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import {
  canModerateComment,
  pinTopLevelComment,
  softDeleteComment,
  unpinComment,
} from "./clip-comment-moderation"
import {
  CommentIdParam,
  CreateBody,
  InvalidCommentCursorError,
  listClipComments,
  ListQuery,
  resolveCommentEngagementTarget,
  UpdateBody,
} from "./clip-comments-helpers"
import { IdParam } from "./clips-helpers"
import { serialiseUserSummary, userSummarySelectShape } from "./users-helpers"
import { zValidator } from "./validation"

export const clipCommentsRoutes = new Hono()
  .get(
    "/:id/comments",
    zValidator("param", IdParam),
    zValidator("query", ListQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { sort, limit, cursor } = c.req.valid("query")

      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "metadata",
      })
      if (!access.accessible) return clipAccessResponse(c, access)

      try {
        return c.json(
          await listClipComments({
            clipId: id,
            sort,
            limit,
            cursor,
            viewerId: access.viewer?.id ?? null,
            clipAuthorId: access.row.authorId,
          }),
        )
      } catch (err) {
        if (err instanceof InvalidCommentCursorError) {
          return invalidCursor(c)
        }
        throw err
      }
    },
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

      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "engagement",
      })
      if (!access.accessible) return clipAccessResponse(c, access)

      let resolvedParentId: string | null = null
      if (parentId) {
        const [parent] = await db
          .select({
            id: clipComment.id,
            clipId: clipComment.clipId,
          })
          .from(clipComment)
          .where(eq(clipComment.id, parentId))
          .limit(1)
        if (!parent || parent.clipId !== id) {
          return notFound(c, "Parent comment not found")
        }
        resolvedParentId = parent.id
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
      if (!inserted) return internalServerError(c, "Insert failed")

      const [authorRow] = await db
        .select(userSummarySelectShape)
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
        createdAt: isoDate(inserted.createdAt),
        editedAt: null,
        author: authorRow
          ? serialiseUserSummary(authorRow)
          : {
              id: viewerId,
              username: "",
              displayUsername: "",
              image: null,
            },
        replies: [],
      }
      return c.json(out, 201)
    },
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
      if (!existing) return notFound(c)
      if (existing.authorId !== viewerId) {
        return forbidden(c)
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
      if (!updated) {
        return internalServerError(c, "Comment update did not persist")
      }
      return c.json({
        id: updated.id,
        body: updated.body,
        editedAt: nullableIsoDate(updated.editedAt),
      })
    },
  )
  .delete(
    "/comments/:commentId",
    requireSession,
    zValidator("param", CommentIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")

      const target = await canModerateComment({
        commentId,
        viewerId,
        headers: c.req.raw.headers,
      })
      if (!target.ok) {
        return errorResult(c, target)
      }

      await softDeleteComment(target.row.id)
      return deleted(c)
    },
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
        c.req.raw.headers,
      )
      if (!target.accessible) {
        return clipAccessResponse(c, target)
      }

      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(clipCommentLike)
          .values({ commentId, userId: viewerId })
          .onConflictDoNothing()
          .returning({ commentId: clipCommentLike.commentId })
        if (inserted.length === 0) {
          const [row] = await tx
            .select({ likeCount: clipComment.likeCount })
            .from(clipComment)
            .where(eq(clipComment.id, commentId))
            .limit(1)
          return row ? { liked: true, likeCount: row.likeCount } : null
        }
        const [row] = await tx
          .update(clipComment)
          .set({ likeCount: sql`${clipComment.likeCount} + 1` })
          .where(eq(clipComment.id, commentId))
          .returning({ likeCount: clipComment.likeCount })
        if (!row) return null
        return { liked: true, likeCount: row.likeCount }
      })
      if (!result) return notFound(c)
      return likeState(c, result.liked, result.likeCount)
    },
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
        c.req.raw.headers,
      )
      if (!target.accessible) {
        return clipAccessResponse(c, target)
      }

      const result = await db.transaction(async (tx) => {
        const removed = await tx
          .delete(clipCommentLike)
          .where(
            and(
              eq(clipCommentLike.commentId, commentId),
              eq(clipCommentLike.userId, viewerId),
            ),
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
      if (!result) return notFound(c)
      return likeState(c, result.liked, result.likeCount)
    },
  )
  .post(
    "/comments/:commentId/pin",
    requireSession,
    zValidator("param", CommentIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")

      const result = await pinTopLevelComment({ commentId, viewerId })
      if (!result.ok) {
        return errorResult(c, result)
      }
      return booleanFlag(c, "pinned", true)
    },
  )
  .delete(
    "/comments/:commentId/pin",
    requireSession,
    zValidator("param", CommentIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { commentId } = c.req.valid("param")

      const result = await unpinComment({ commentId, viewerId })
      if (!result.ok) {
        return errorResult(c, result)
      }
      return booleanFlag(c, "pinned", false)
    },
  )
