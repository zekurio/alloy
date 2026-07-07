import type {
  NotificationItem,
  NotificationKind,
  NotificationListResponse,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipComment, notification } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"

import { clipAssetVersion } from "../clips/asset-version"
import {
  cursorDate,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "../routes/cursor-codec"
import {
  serialiseUserSummary,
  userSummarySelectShape,
} from "../routes/users-helpers"
import { publishNotification } from "./events"

export type NotificationRow = typeof notification.$inferSelect

export async function createNotification(input: {
  recipientId: string
  actorId: string
  kind: NotificationKind
  clipId?: string | null
  commentId?: string | null
  dedupKey?: string | null
}): Promise<void> {
  if (input.recipientId === input.actorId) return
  const rows = await db
    .insert(notification)
    .values({
      recipient_id: input.recipientId,
      actor_id: input.actorId,
      kind: input.kind,
      clip_id: input.clipId ?? null,
      comment_id: input.commentId ?? null,
      dedup_key: input.dedupKey ?? null,
    })
    .onConflictDoNothing()
    .returning()
  const row = rows[0]
  if (!row) return
  const items = await hydrateNotifications([row])
  const item = items[0]
  if (item) publishNotification(input.recipientId, item)
}

export async function hydrateNotifications(
  rows: NotificationRow[],
): Promise<NotificationItem[]> {
  const actorIds = [...new Set(rows.map((row) => row.actor_id))]
  const clipIds = [
    ...new Set(rows.flatMap((row) => (row.clip_id ? [row.clip_id] : []))),
  ]
  const commentIds = [
    ...new Set(rows.flatMap((row) => (row.comment_id ? [row.comment_id] : []))),
  ]
  const [actors, clips, comments] = await Promise.all([
    actorIds.length > 0
      ? db
          .select(userSummarySelectShape)
          .from(user)
          .where(inArray(user.id, actorIds))
      : [],
    clipIds.length > 0
      ? db
          .select({
            id: clip.id,
            title: clip.title,
            thumbKey: clip.thumb_key,
          })
          .from(clip)
          .where(inArray(clip.id, clipIds))
      : [],
    commentIds.length > 0
      ? db
          .select({ id: clipComment.id, body: clipComment.body })
          .from(clipComment)
          .where(inArray(clipComment.id, commentIds))
      : [],
  ])
  const actorsById = new Map(
    actors.map((actor) => [actor.id, serialiseUserSummary(actor)]),
  )
  const clipsById = new Map(
    clips.map((row) => [
      row.id,
      {
        id: row.id,
        title: row.title,
        thumbVersion: row.thumbKey ? clipAssetVersion(row.thumbKey) : null,
      },
    ]),
  )
  const commentsById = new Map(comments.map((row) => [row.id, row.body]))
  return rows.flatMap((row) => {
    const actor = actorsById.get(row.actor_id)
    if (!actor) return []
    const commentBody = row.comment_id ? commentsById.get(row.comment_id) : null
    return [
      {
        id: row.id,
        kind: row.kind,
        actor,
        clip: row.clip_id ? (clipsById.get(row.clip_id) ?? null) : null,
        commentId: row.comment_id,
        commentSnippet: commentBody ? commentBody.slice(0, 80) : null,
        readAt: nullableIsoDate(row.read_at),
        createdAt: isoDate(row.created_at),
      },
    ]
  })
}

export async function listNotifications(
  viewerId: string,
  input: { cursor?: string; limit: number },
): Promise<NotificationListResponse> {
  const cursor = decodeNotificationCursor(input.cursor)
  const conditions = [eq(notification.recipient_id, viewerId)]
  if (cursor) {
    conditions.push(
      or(
        lt(notification.created_at, cursor.createdAt),
        and(
          eq(notification.created_at, cursor.createdAt),
          sql`${notification.id} < ${cursor.id}`,
        ),
      )!,
    )
  }
  const rows = await db
    .select()
    .from(notification)
    .where(and(...conditions))
    .orderBy(desc(notification.created_at), desc(notification.id))
    .limit(input.limit + 1)
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return {
    items: await hydrateNotifications(page),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursorPayload({
            createdAt: isoDate(last.created_at),
            id: last.id,
          })
        : null,
    unreadCount: await countUnread(viewerId),
  }
}

export async function countUnread(viewerId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.recipient_id, viewerId),
        sql`${notification.read_at} is null`,
      ),
    )
  return row?.value ?? 0
}

export async function markRead(viewerId: string, id: string): Promise<void> {
  await db
    .update(notification)
    .set({ read_at: new Date() })
    .where(
      and(
        eq(notification.id, id),
        eq(notification.recipient_id, viewerId),
        sql`${notification.read_at} is null`,
      ),
    )
}

export async function markAllRead(viewerId: string): Promise<void> {
  await db
    .update(notification)
    .set({ read_at: new Date() })
    .where(
      and(
        eq(notification.recipient_id, viewerId),
        sql`${notification.read_at} is null`,
      ),
    )
}

function decodeNotificationCursor(value: string | undefined) {
  const payload = decodeCursorPayload(value)
  if (!payload) return null
  const createdAt = cursorDate(payload.createdAt)
  const id = cursorRequiredString(payload.id)
  if (!createdAt || !id) return null
  return { createdAt, id }
}
