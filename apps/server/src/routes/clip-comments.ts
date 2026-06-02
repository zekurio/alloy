import { zValidator } from "./validation"
import { and, eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import type { CommentRow } from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip, clipComment, clipCommentLike } from "@workspace/db/schema"

import { db } from "../db"
import {
  applyClipPrivacyHeaders,
  clipAccessResponse,
  resolveClipAccess,
} from "../clips/access"
import { createNotification } from "../notifications"
import { requireSession } from "../auth/require-session"
import { isoDate, nullableIsoDate } from "../runtime/date"
import {
  booleanFlag,
  deleted,
  errorResult,
  forbidden,
  internalServerError,
  invalidCursor,
  likeState,
  notFound,
} from "../runtime/http-response"
import { IdParam } from "./clips-helpers"
import {
  CommentIdParam,
  CreateBody,
  InvalidCommentCursorError,
  listClipComments,
  ListQuery,
  resolveCommentEngagementTarget,
  UpdateBody,
} from "./clip-comments-helpers"
import { serialiseUserSummary, userSummarySelectShape } from "./users-helpers"
import {
  canModerateComment,
  pinTopLevelComment,
  softDeleteComment,
  unpinComment,
} from "./clip-comment-moderation"

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
      applyClipPrivacyHeaders(c, access)

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
      let parentAuthorId: string | null = null
      if (parentId) {
        const [parent] = await db
          .select({
            id: clipComment.id,
            clipId: clipComment.clipId,
            authorId: clipComment.authorId,
            parentId: clipComment.parentId,
          })
          .from(clipComment)
          .where(eq(clipComment.id, parentId))
          .limit(1)
        if (!parent || parent.clipId !== id) {
          return notFound(c, "Parent comment not found")
        }
        resolvedParentId = parent.id
        parentAuthorId = parent.authorId
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

      void createNotification({
        recipientId: access.row.authorId,
        actorId: viewerId,
        type: "clip_comment",
        clipId: id,
        commentId: inserted.id,
      })
      if (parentAuthorId && parentAuthorId !== access.row.authorId) {
        void createNotification({
          recipientId: parentAuthorId,
          actorId: viewerId,
          type: "comment_reply",
          clipId: id,
          commentId: inserted.id,
        })
      }

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
        author: authorRow ? serialiseUserSummary(authorRow) : {
          id: viewerId,
          username: "",
          displayUsername: "",
          name: "",
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
      if (!result) return notFound(c)
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
      void createNotification({
        recipientId: result.row.authorId,
        actorId: viewerId,
        type: "comment_pinned",
        clipId: result.row.clipId,
        commentId,
      })
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
