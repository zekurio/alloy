import { clipComment, clipCommentLike } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { db } from "@alloy/server/db/index"
import { createNotification } from "@alloy/server/notifications/service"
import {
  booleanFlag,
  deleted,
  errorResult,
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
import { clipCommentWriteRoutes } from "./clip-comment-write-routes"
import {
  CommentIdParam,
  InvalidCommentCursorError,
  listClipComments,
  ListQuery,
  resolveCommentEngagementTarget,
} from "./clip-comments-helpers"
import { IdParam } from "./clips-helpers"
import { zValidator } from "./validation"

const logger = createLogger("clip-comments")

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
        c,
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
            clipAuthorId: access.row.author_id,
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
  .route("/", clipCommentWriteRoutes)
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
        c,
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

      const target = await resolveCommentEngagementTarget(commentId, c)
      if (!target.accessible) {
        return clipAccessResponse(c, target)
      }

      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(clipCommentLike)
          .values({ comment_id: commentId, user_id: viewerId })
          .onConflictDoNothing()
          .returning({ commentId: clipCommentLike.comment_id })
        if (inserted.length === 0) {
          const [row] = await tx
            .select({ likeCount: clipComment.like_count })
            .from(clipComment)
            .where(eq(clipComment.id, commentId))
            .limit(1)
          return row
            ? { liked: true, likeCount: row.likeCount, created: false }
            : null
        }
        const [row] = await tx
          .update(clipComment)
          .set({ like_count: sql`${clipComment.like_count} + 1` })
          .where(eq(clipComment.id, commentId))
          .returning({ likeCount: clipComment.like_count })
        if (!row) return null
        return { liked: true, likeCount: row.likeCount, created: true }
      })
      if (!result) return notFound(c)
      if (
        result.created &&
        viewerId === target.clipAuthorId &&
        target.commentAuthorId !== viewerId
      ) {
        void createNotification({
          recipientId: target.commentAuthorId,
          actorId: viewerId,
          kind: "comment_like",
          clipId: target.clipId,
          commentId: target.commentId,
          dedupKey: `comment_like:${target.commentId}:${viewerId}`,
        }).catch((error) => logger.error("notification fan-out failed", error))
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

      const target = await resolveCommentEngagementTarget(commentId, c)
      if (!target.accessible) {
        return clipAccessResponse(c, target)
      }

      const result = await db.transaction(async (tx) => {
        const removed = await tx
          .delete(clipCommentLike)
          .where(
            and(
              eq(clipCommentLike.comment_id, commentId),
              eq(clipCommentLike.user_id, viewerId),
            ),
          )
          .returning({ commentId: clipCommentLike.comment_id })
        if (removed.length === 0) {
          const [row] = await tx
            .select({ likeCount: clipComment.like_count })
            .from(clipComment)
            .where(eq(clipComment.id, commentId))
            .limit(1)
          return row ? { liked: false, likeCount: row.likeCount } : null
        }
        const [row] = await tx
          .update(clipComment)
          .set({ like_count: sql`GREATEST(0, ${clipComment.like_count} - 1)` })
          .where(eq(clipComment.id, commentId))
          .returning({ likeCount: clipComment.like_count })
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
