import { parseMentionUsernames, type CommentRow } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipComment, clipCommentMention } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { db } from "@alloy/server/db/index"
import { createNotification } from "@alloy/server/notifications/service"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import {
  forbidden,
  internalServerError,
  notFound,
} from "@alloy/server/runtime/http-response"
import { eq, inArray, sql } from "drizzle-orm"
import { Hono } from "hono"

import { CommentIdParam, CreateBody, UpdateBody } from "./clip-comments-helpers"
import { IdParam } from "./clips-helpers"
import { resolveMentionUsernames } from "./clips-upload-helpers"
import { serialiseUserSummary, userSummarySelectShape } from "./users-helpers"
import { zValidator } from "./validation"

const logger = createLogger("clip-comments")

export const clipCommentWriteRoutes = new Hono()
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
        c,
        policy: "engagement",
      })
      if (!access.accessible) return clipAccessResponse(c, access)

      const parent = parentId
        ? (
            await db
              .select({
                id: clipComment.id,
                clipId: clipComment.clip_id,
                authorId: clipComment.author_id,
              })
              .from(clipComment)
              .where(eq(clipComment.id, parentId))
              .limit(1)
          )[0]
        : null
      if (parentId && (!parent || parent.clipId !== id)) {
        return notFound(c, "Parent comment not found")
      }
      const resolvedParentId = parent?.id ?? null

      const [inserted] = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(clipComment)
          .values({
            clip_id: id,
            author_id: viewerId,
            parent_id: resolvedParentId,
            body,
          })
          .returning()
        await tx
          .update(clip)
          .set({ comment_count: sql`${clip.comment_count} + 1` })
          .where(eq(clip.id, id))
        return rows
      })
      if (!inserted) return internalServerError(c, "Insert failed")

      const mentionUserIds = await resolveMentionUsernames(
        parseMentionUsernames(body),
        viewerId,
      )
      if (mentionUserIds.length > 0) {
        await db
          .insert(clipCommentMention)
          .values(
            mentionUserIds.map((mentionedUserId) => ({
              comment_id: inserted.id,
              mentioned_user_id: mentionedUserId,
            })),
          )
          .onConflictDoNothing()
      }
      const mentionedUsers =
        mentionUserIds.length > 0
          ? await db
              .select({ id: user.id, username: user.username })
              .from(user)
              .where(inArray(user.id, mentionUserIds))
          : []
      const mentionedUsernames = mentionedUsers.map((row) =>
        row.username.toLowerCase(),
      )
      const alreadyNotified = new Set<string>()
      const commentNotification = parent
        ? { recipientId: parent.authorId, kind: "comment_reply" as const }
        : { recipientId: access.row.author_id, kind: "clip_comment" as const }
      alreadyNotified.add(commentNotification.recipientId)
      void createNotification({
        recipientId: commentNotification.recipientId,
        actorId: viewerId,
        kind: commentNotification.kind,
        clipId: id,
        commentId: inserted.id,
      }).catch((error) => logger.error("notification fan-out failed", error))
      for (const recipientId of mentionUserIds) {
        if (alreadyNotified.has(recipientId)) continue
        void createNotification({
          recipientId,
          actorId: viewerId,
          kind: "comment_mention",
          clipId: id,
          commentId: inserted.id,
        }).catch((error) => logger.error("notification fan-out failed", error))
      }

      const [authorRow] = await db
        .select(userSummarySelectShape)
        .from(user)
        .where(eq(user.id, viewerId))
        .limit(1)

      const out: CommentRow = {
        id: inserted.id,
        clipId: inserted.clip_id,
        parentId: inserted.parent_id,
        body: inserted.body,
        likeCount: inserted.like_count,
        pinned: false,
        pinnedAt: null,
        likedByViewer: false,
        likedByAuthor: false,
        createdAt: isoDate(inserted.created_at),
        editedAt: null,
        author: authorRow
          ? serialiseUserSummary(authorRow)
          : {
              id: viewerId,
              username: "",
              image: null,
            },
        mentions: mentionedUsernames,
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
        .select({
          id: clipComment.id,
          authorId: clipComment.author_id,
          body: clipComment.body,
          clipId: clipComment.clip_id,
          parentId: clipComment.parent_id,
        })
        .from(clipComment)
        .where(eq(clipComment.id, commentId))
        .limit(1)
      if (!existing) return notFound(c)
      if (existing.authorId !== viewerId) return forbidden(c)

      const mentionUsernames = parseMentionUsernames(body)
      const previousMentionUsernames = new Set(
        parseMentionUsernames(existing.body),
      )
      const addedMentionUsernames = mentionUsernames.filter(
        (username) => !previousMentionUsernames.has(username),
      )
      const mentionUserIds = await resolveMentionUsernames(
        mentionUsernames,
        viewerId,
      )
      const addedMentionUserIds = await resolveMentionUsernames(
        addedMentionUsernames,
        viewerId,
      )
      const [commentNotificationTarget] = existing.parentId
        ? await db
            .select({ recipientId: clipComment.author_id })
            .from(clipComment)
            .where(eq(clipComment.id, existing.parentId))
            .limit(1)
        : await db
            .select({ recipientId: clip.author_id })
            .from(clip)
            .where(eq(clip.id, existing.clipId))
            .limit(1)
      const alreadyNotified = new Set(
        commentNotificationTarget
          ? [commentNotificationTarget.recipientId]
          : [],
      )

      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(clipComment)
          .set({ body, edited_at: new Date() })
          .where(eq(clipComment.id, commentId))
          .returning({
            id: clipComment.id,
            body: clipComment.body,
            editedAt: clipComment.edited_at,
          })
        await tx
          .delete(clipCommentMention)
          .where(eq(clipCommentMention.comment_id, commentId))
        if (mentionUserIds.length > 0) {
          await tx.insert(clipCommentMention).values(
            mentionUserIds.map((mentionedUserId) => ({
              comment_id: commentId,
              mentioned_user_id: mentionedUserId,
            })),
          )
        }
        return rows
      })
      if (!updated) {
        return internalServerError(c, "Comment update did not persist")
      }
      for (const recipientId of addedMentionUserIds) {
        if (alreadyNotified.has(recipientId)) continue
        void createNotification({
          recipientId,
          actorId: viewerId,
          kind: "comment_mention",
          clipId: existing.clipId,
          commentId,
        }).catch((error) => logger.error("notification fan-out failed", error))
      }
      return c.json({
        id: updated.id,
        body: updated.body,
        editedAt: nullableIsoDate(updated.editedAt),
      })
    },
  )
