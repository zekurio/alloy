import { and, count, desc, eq, isNull } from "drizzle-orm"

import type {
  NotificationRow,
  NotificationType,
  NotificationsResponse,
  UserSummary,
} from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip, clipComment, game, notification } from "@workspace/db/schema"

import { db } from "../db"
import {
  publishNotificationRemove,
  publishNotificationRead,
  publishNotificationsClear,
  publishNotificationsReadAll,
  publishNotificationUpsert,
} from "./notification-events"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

interface CreateNotificationInput {
  recipientId: string
  actorId?: string | null
  type: NotificationType
  clipId?: string | null
  commentId?: string | null
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : value
}

function actorShape(row: {
  actorId: string | null
  actorUsername: string | null
  actorDisplayUsername: string | null
  actorName: string | null
  actorImage: string | null
}): UserSummary | null {
  if (!row.actorId) return null
  return {
    id: row.actorId,
    username: row.actorUsername ?? "",
    displayUsername: row.actorDisplayUsername ?? "",
    name: row.actorName ?? "",
    image: row.actorImage,
  }
}

function serialize(row: {
  id: string
  type: NotificationType
  readAt: Date | string | null
  createdAt: Date | string
  actorId: string | null
  actorUsername: string | null
  actorDisplayUsername: string | null
  actorName: string | null
  actorImage: string | null
  clipId: string | null
  clipSlug: string | null
  clipTitle: string | null
  gameSlug: string | null
  commentId: string | null
  commentBody: string | null
}): NotificationRow {
  return {
    id: row.id,
    type: row.type,
    actor: actorShape(row),
    clip:
      row.clipId && row.clipSlug && row.clipTitle
        ? {
            id: row.clipId,
            slug: row.clipSlug,
            title: row.clipTitle,
            gameSlug: row.gameSlug,
          }
        : null,
    comment:
      row.commentId && row.commentBody
        ? { id: row.commentId, body: row.commentBody }
        : null,
    readAt: iso(row.readAt),
    createdAt: iso(row.createdAt)!,
  }
}

async function unreadCount(recipientId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notification)
    .where(
      and(
        eq(notification.recipientId, recipientId),
        isNull(notification.readAt)
      )
    )
  return row?.value ?? 0
}

async function selectNotificationById(
  id: string,
  recipientId: string
): Promise<NotificationRow | null> {
  const [row] = await db
    .select({
      id: notification.id,
      type: notification.type,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      actorId: user.id,
      actorUsername: user.username,
      actorDisplayUsername: user.displayUsername,
      actorName: user.name,
      actorImage: user.image,
      clipId: clip.id,
      clipSlug: clip.slug,
      clipTitle: clip.title,
      gameSlug: game.slug,
      commentId: clipComment.id,
      commentBody: clipComment.body,
    })
    .from(notification)
    .leftJoin(user, eq(notification.actorId, user.id))
    .leftJoin(clip, eq(notification.clipId, clip.id))
    .leftJoin(game, eq(clip.gameId, game.id))
    .leftJoin(clipComment, eq(notification.commentId, clipComment.id))
    .where(
      and(eq(notification.id, id), eq(notification.recipientId, recipientId))
    )
    .limit(1)

  return row ? serialize(row) : null
}

export async function listNotifications(
  recipientId: string,
  limit = DEFAULT_LIMIT
): Promise<NotificationsResponse> {
  const boundedLimit = Math.min(Math.max(1, limit), MAX_LIMIT)
  const [rows, unread] = await Promise.all([
    db
      .select({
        id: notification.id,
        type: notification.type,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        actorId: user.id,
        actorUsername: user.username,
        actorDisplayUsername: user.displayUsername,
        actorName: user.name,
        actorImage: user.image,
        clipId: clip.id,
        clipSlug: clip.slug,
        clipTitle: clip.title,
        gameSlug: game.slug,
        commentId: clipComment.id,
        commentBody: clipComment.body,
      })
      .from(notification)
      .leftJoin(user, eq(notification.actorId, user.id))
      .leftJoin(clip, eq(notification.clipId, clip.id))
      .leftJoin(game, eq(clip.gameId, game.id))
      .leftJoin(clipComment, eq(notification.commentId, clipComment.id))
      .where(eq(notification.recipientId, recipientId))
      .orderBy(desc(notification.createdAt))
      .limit(boundedLimit),
    unreadCount(recipientId),
  ])

  return { items: rows.map(serialize), unreadCount: unread }
}

export async function createNotification(
  input: CreateNotificationInput
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
    // Notification writes should not make the primary user action fail.
    // eslint-disable-next-line no-console
    console.warn("[notifications] failed to create notification:", err)
    return null
  }
}

export async function markNotificationRead(
  recipientId: string,
  id: string
): Promise<NotificationRow | null> {
  const readAt = new Date()
  const [updated] = await db
    .update(notification)
    .set({ readAt })
    .where(
      and(eq(notification.id, id), eq(notification.recipientId, recipientId))
    )
    .returning({ id: notification.id })
  if (!updated) return null

  const [row, unread] = await Promise.all([
    selectNotificationById(id, recipientId),
    unreadCount(recipientId),
  ])
  publishNotificationRead(recipientId, id, readAt.toISOString(), unread)
  return row
}

export async function markAllNotificationsRead(
  recipientId: string
): Promise<{ readAt: string; unreadCount: number }> {
  const readAt = new Date()
  await db
    .update(notification)
    .set({ readAt })
    .where(
      and(
        eq(notification.recipientId, recipientId),
        isNull(notification.readAt)
      )
    )
  const unread = await unreadCount(recipientId)
  const isoReadAt = readAt.toISOString()
  publishNotificationsReadAll(recipientId, isoReadAt, unread)
  return { readAt: isoReadAt, unreadCount: unread }
}

export async function deleteNotification(
  recipientId: string,
  id: string
): Promise<{ deleted: true; unreadCount: number } | null> {
  const removed = await db
    .delete(notification)
    .where(
      and(eq(notification.id, id), eq(notification.recipientId, recipientId))
    )
    .returning({ id: notification.id })
  if (removed.length === 0) return null

  const unread = await unreadCount(recipientId)
  publishNotificationRemove(recipientId, id, unread)
  return { deleted: true, unreadCount: unread }
}

export async function clearNotifications(
  recipientId: string
): Promise<{ deleted: true; unreadCount: number }> {
  await db.delete(notification).where(eq(notification.recipientId, recipientId))
  const unread = await unreadCount(recipientId)
  publishNotificationsClear(recipientId, unread)
  return { deleted: true, unreadCount: unread }
}
