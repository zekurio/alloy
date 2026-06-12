import type {
  NotificationRow,
  NotificationsResponse,
  NotificationType,
} from "@alloy/contracts"
import {
  NOTIFICATIONS_DEFAULT_LIMIT,
  NOTIFICATIONS_MAX_LIMIT,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipComment, follow, notification } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { gameSlugWithId } from "@alloy/server/games/slug"
import { serialiseNullableUserSummary } from "@alloy/server/routes/users-helpers"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import { and, count, desc, eq, gt, isNull } from "drizzle-orm"

import {
  publishNotificationRead,
  publishNotificationRemove,
  publishNotificationsClear,
  publishNotificationsReadAll,
  publishNotificationUpsert,
} from "./events"

const logger = createLogger("notifications")

const NEW_VIDEO_FANOUT_BATCH_SIZE = 10
const NEW_VIDEO_FANOUT_PAGE_SIZE = 100

interface CreateNotificationInput {
  recipientId: string
  actorId?: string | null
  type: NotificationType
  clipId?: string | null
  commentId?: string | null
  suppressErrors?: boolean
}

type NotificationDeleteResult = { deleted: true; unreadCount: number }

function notificationDeleteResult(
  unreadCount: number,
): NotificationDeleteResult {
  return { deleted: true, unreadCount }
}

function serialize(row: {
  id: string
  type: NotificationType
  readAt: Date | string | null
  createdAt: Date | string
  actorId: string | null
  actorUsername: string | null
  actorDisplayUsername: string | null
  actorImage: string | null
  clipId: string | null
  clipTitle: string | null
  clipThumbKey: string | null
  clipThumbBlurHash: string | null
  clipUpdatedAt: Date | string | null
  clipGame: string | null
  steamgriddbId: number | null
  commentId: string | null
  commentBody: string | null
}): NotificationRow {
  const gameName =
    row.steamgriddbId === null
      ? null
      : row.clipGame?.trim() || `Game ${row.steamgriddbId}`
  return {
    id: row.id,
    type: row.type,
    actor: serialiseNullableUserSummary({
      id: row.actorId,
      username: row.actorUsername,
      displayUsername: row.actorDisplayUsername,
      image: row.actorImage,
    }),
    clip:
      row.clipId && row.clipTitle && gameName && row.clipUpdatedAt
        ? {
            id: row.clipId,
            title: row.clipTitle,
            gameSlug: gameSlugWithId(gameName, row.steamgriddbId ?? 0),
            hasThumb: row.clipThumbKey !== null,
            thumbBlurHash: row.clipThumbBlurHash,
            updatedAt: isoDate(row.clipUpdatedAt),
          }
        : null,
    comment:
      row.commentId && row.commentBody
        ? { id: row.commentId, body: row.commentBody }
        : null,
    readAt: nullableIsoDate(row.readAt),
    createdAt: isoDate(row.createdAt),
  }
}

function selectNotificationFields() {
  return {
    id: notification.id,
    type: notification.type,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
    actorId: user.id,
    actorUsername: user.username,
    actorDisplayUsername: user.displayUsername,
    actorImage: user.image,
    clipId: clip.id,
    clipTitle: clip.title,
    clipThumbKey: clip.thumbKey,
    clipThumbBlurHash: clip.thumbBlurHash,
    clipUpdatedAt: clip.updatedAt,
    clipGame: clip.game,
    steamgriddbId: clip.steamgriddbId,
    commentId: clipComment.id,
    commentBody: clipComment.body,
  }
}

function notificationDetailsQuery() {
  return db
    .select(selectNotificationFields())
    .from(notification)
    .leftJoin(user, eq(notification.actorId, user.id))
    .leftJoin(clip, eq(notification.clipId, clip.id))
    .leftJoin(clipComment, eq(notification.commentId, clipComment.id))
}

async function unreadCount(recipientId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notification)
    .where(
      and(
        eq(notification.recipientId, recipientId),
        isNull(notification.readAt),
      ),
    )
  return row?.value ?? 0
}

async function selectNotificationById(
  id: string,
  recipientId: string,
): Promise<NotificationRow | null> {
  const [row] = await notificationDetailsQuery()
    .where(
      and(eq(notification.id, id), eq(notification.recipientId, recipientId)),
    )
    .limit(1)

  return row ? serialize(row) : null
}

export async function listNotifications(
  recipientId: string,
  limit = NOTIFICATIONS_DEFAULT_LIMIT,
): Promise<NotificationsResponse> {
  const boundedLimit = Math.min(Math.max(1, limit), NOTIFICATIONS_MAX_LIMIT)
  const [rows, unread] = await Promise.all([
    notificationDetailsQuery()
      .where(eq(notification.recipientId, recipientId))
      .orderBy(desc(notification.createdAt))
      .limit(boundedLimit),
    unreadCount(recipientId),
  ])

  return { items: rows.map(serialize), unreadCount: unread }
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  try {
    if (input.actorId && input.actorId === input.recipientId) return null

    const [inserted] = await db
      .insert(notification)
      .values({
        id: crypto.randomUUID(),
        recipientId: input.recipientId,
        actorId: input.actorId ?? null,
        type: input.type,
        clipId: input.clipId ?? null,
        commentId: input.commentId ?? null,
      })
      .returning({ id: notification.id })
    if (!inserted) return null

    const [row, unread] = await Promise.all([
      selectNotificationById(inserted.id, input.recipientId),
      unreadCount(input.recipientId),
    ])
    if (row) publishNotificationUpsert(input.recipientId, row, unread)
    return row
  } catch (err) {
    if (input.suppressErrors === false) throw err
    // Notification writes should not make the primary user action fail.
    logger.warn("failed to create notification:", err)
    return null
  }
}

export async function markNotificationRead(
  recipientId: string,
  id: string,
): Promise<NotificationRow | null> {
  const readAt = new Date()
  const [updated] = await db
    .update(notification)
    .set({ readAt })
    .where(
      and(eq(notification.id, id), eq(notification.recipientId, recipientId)),
    )
    .returning({ id: notification.id })
  if (!updated) return null

  const [row, unread] = await Promise.all([
    selectNotificationById(id, recipientId),
    unreadCount(recipientId),
  ])
  publishNotificationRead(recipientId, id, isoDate(readAt), unread)
  return row
}

export async function markAllNotificationsRead(
  recipientId: string,
): Promise<{ readAt: string; unreadCount: number }> {
  const readAt = new Date()
  await db
    .update(notification)
    .set({ readAt })
    .where(
      and(
        eq(notification.recipientId, recipientId),
        isNull(notification.readAt),
      ),
    )
  const unread = await unreadCount(recipientId)
  const isoReadAt = isoDate(readAt)
  publishNotificationsReadAll(recipientId, isoReadAt, unread)
  return { readAt: isoReadAt, unreadCount: unread }
}

export async function deleteNotification(
  recipientId: string,
  id: string,
): Promise<NotificationDeleteResult | null> {
  const removed = await db
    .delete(notification)
    .where(
      and(eq(notification.id, id), eq(notification.recipientId, recipientId)),
    )
    .returning({ id: notification.id })
  if (removed.length === 0) return null

  const unread = await unreadCount(recipientId)
  publishNotificationRemove(recipientId, id, unread)
  return notificationDeleteResult(unread)
}

export async function notifyFollowersOfNewClip(input: {
  authorId: string
  clipId: string
}): Promise<void> {
  try {
    let cursor: string | null = null
    for (;;) {
      const followers = await db
        .select({ id: follow.id, followerId: follow.followerId })
        .from(follow)
        .where(
          cursor
            ? and(eq(follow.followingId, input.authorId), gt(follow.id, cursor))
            : eq(follow.followingId, input.authorId),
        )
        .orderBy(follow.id)
        .limit(NEW_VIDEO_FANOUT_PAGE_SIZE)

      if (followers.length === 0) return

      for (let i = 0; i < followers.length; i += NEW_VIDEO_FANOUT_BATCH_SIZE) {
        const batch = followers.slice(i, i + NEW_VIDEO_FANOUT_BATCH_SIZE)
        await Promise.all(
          batch.map((row) =>
            createNotification({
              recipientId: row.followerId,
              actorId: input.authorId,
              type: "new_video",
              clipId: input.clipId,
            }),
          ),
        )
      }

      cursor = followers[followers.length - 1]?.id ?? null
      if (followers.length < NEW_VIDEO_FANOUT_PAGE_SIZE) return
    }
  } catch (err) {
    logger.warn("new-video fanout failed:", err)
  }
}

export async function clearNotifications(
  recipientId: string,
): Promise<NotificationDeleteResult> {
  await db.delete(notification).where(eq(notification.recipientId, recipientId))
  const unread = await unreadCount(recipientId)
  publishNotificationsClear(recipientId, unread)
  return notificationDeleteResult(unread)
}
