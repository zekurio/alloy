import type {
  NotificationItem,
  NotificationKind,
  NotificationListResponse,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipComment, clipMention, notification } from "@alloy/db/schema"
import type { ClipViewer } from "@alloy/server/clips/access-policy"
import { db } from "@alloy/server/db/index"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"

import {
  cursorDate,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "../routes/cursor-codec"
import {
  serialiseUserSummary,
  userSummarySelection,
} from "../routes/users-helpers"
import { publishNotification } from "./events"
import { insertNotificationAndWake, mutateNotificationsAndWake } from "./expiry"
import {
  notificationReferenceFields,
  type NotificationClipSource,
  type NotificationCommentSource,
} from "./hydration"

export type NotificationRow = typeof notification.$inferSelect
type AuthenticatedClipViewer = Exclude<ClipViewer, null>

export class InvalidNotificationCursorError extends Error {
  constructor() {
    super("Invalid cursor")
    this.name = "InvalidNotificationCursorError"
  }
}

export async function createNotification(input: {
  recipientId: string
  actorId: string
  kind: NotificationKind
  clipId?: string | null
  commentId?: string | null
  dedupKey?: string | null
}): Promise<void> {
  if (input.recipientId === input.actorId) return
  const row = await insertNotificationAndWake(async () => {
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
    return rows[0] ?? null
  })
  if (!row) return
  // The expiry wake already ran. Hydration/publish failures therefore cannot
  // suppress cleanup scheduling for this durable row.
  const [recipient] = await db
    .select({ id: user.id, role: user.role, status: user.status })
    .from(user)
    .where(and(eq(user.id, input.recipientId), eq(user.status, "active")))
    .limit(1)
  if (!recipient) return
  const items = await hydrateNotifications([row], recipient)
  const item = items[0]
  if (item) publishNotification(input.recipientId, item)
}

export async function createStoredClipMentionNotifications(
  clipId: string,
): Promise<void> {
  const rows = await db
    .select({
      recipientId: clipMention.mentioned_user_id,
      actorId: clip.author_id,
    })
    .from(clipMention)
    .innerJoin(clip, eq(clipMention.clip_id, clip.id))
    .where(eq(clipMention.clip_id, clipId))

  for (const row of rows) {
    await createNotification({
      recipientId: row.recipientId,
      actorId: row.actorId,
      kind: "clip_mention",
      clipId,
      dedupKey: `clip_mention:${clipId}`,
    })
  }
}

export async function hydrateNotifications(
  rows: NotificationRow[],
  viewer: AuthenticatedClipViewer,
): Promise<NotificationItem[]> {
  const actorIds = [
    ...new Set(
      rows.flatMap((row) => (row.actor_id === null ? [] : [row.actor_id])),
    ),
  ]
  const clipIds = [
    ...new Set(rows.flatMap((row) => (row.clip_id ? [row.clip_id] : []))),
  ]
  const commentIds = [
    ...new Set(rows.flatMap((row) => (row.comment_id ? [row.comment_id] : []))),
  ]
  const [actors, clips, comments] = await Promise.all([
    actorIds.length > 0
      ? db
          .select(userSummarySelection)
          .from(user)
          .where(inArray(user.id, actorIds))
      : [],
    clipIds.length > 0
      ? db
          .select({
            id: clip.id,
            authorId: clip.author_id,
            authorDisabledAt: user.disabled_at,
            privacy: clip.privacy,
            status: clip.status,
            title: clip.title,
            thumbKey: clip.thumb_key,
          })
          .from(clip)
          .innerJoin(user, eq(clip.author_id, user.id))
          .where(inArray(clip.id, clipIds))
      : [],
    commentIds.length > 0
      ? db
          .select({
            id: clipComment.id,
            body: clipComment.body,
            clipId: clipComment.clip_id,
            clipAuthorId: clip.author_id,
            clipAuthorDisabledAt: user.disabled_at,
            clipPrivacy: clip.privacy,
            clipStatus: clip.status,
            clipTitle: clip.title,
            clipThumbKey: clip.thumb_key,
          })
          .from(clipComment)
          .innerJoin(clip, eq(clipComment.clip_id, clip.id))
          .innerJoin(user, eq(clip.author_id, user.id))
          .where(inArray(clipComment.id, commentIds))
      : [],
  ])
  const actorsById = new Map(
    actors.map((actor) => [actor.id, serialiseUserSummary(actor)]),
  )
  const clipsById = new Map<string, NotificationClipSource>(
    clips.map((row) => [row.id, row]),
  )
  const commentsById = new Map<string, NotificationCommentSource>(
    comments.map((row) => [
      row.id,
      {
        id: row.id,
        body: row.body,
        clipId: row.clipId,
        clip: {
          id: row.clipId,
          authorId: row.clipAuthorId,
          authorDisabledAt: row.clipAuthorDisabledAt,
          privacy: row.clipPrivacy,
          status: row.clipStatus,
          title: row.clipTitle,
          thumbKey: row.clipThumbKey,
        },
      },
    ]),
  )
  return rows.flatMap((row) => {
    const actor = row.actor_id ? (actorsById.get(row.actor_id) ?? null) : null
    if (row.actor_id && !actor) return []
    const references = notificationReferenceFields(
      viewer,
      row.clip_id,
      row.comment_id,
      row.clip_id ? (clipsById.get(row.clip_id) ?? null) : null,
      row.comment_id ? (commentsById.get(row.comment_id) ?? null) : null,
    )
    return [
      {
        id: row.id,
        kind: row.kind,
        actor,
        ...references,
        readAt: nullableIsoDate(row.read_at),
        createdAt: isoDate(row.created_at),
      },
    ]
  })
}

export async function listNotifications(
  viewer: AuthenticatedClipViewer,
  input: { cursor?: string; limit: number },
): Promise<NotificationListResponse> {
  const cursor = decodeNotificationCursor(input.cursor)
  if (input.cursor && !cursor) {
    throw new InvalidNotificationCursorError()
  }
  const conditions = [eq(notification.recipient_id, viewer.id)]
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
    items: await hydrateNotifications(page, viewer),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursorPayload({
            createdAt: isoDate(last.created_at),
            id: last.id,
          })
        : null,
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
  await mutateNotificationsAndWake(() =>
    db
      .update(notification)
      .set({ read_at: new Date() })
      .where(
        and(
          eq(notification.id, id),
          eq(notification.recipient_id, viewerId),
          sql`${notification.read_at} is null`,
        ),
      ),
  )
}

export async function markAllRead(viewerId: string): Promise<void> {
  await mutateNotificationsAndWake(() =>
    db
      .update(notification)
      .set({ read_at: new Date() })
      .where(
        and(
          eq(notification.recipient_id, viewerId),
          sql`${notification.read_at} is null`,
        ),
      ),
  )
}

export async function removeNotification(
  viewerId: string,
  id: string,
): Promise<void> {
  await db
    .delete(notification)
    .where(
      and(eq(notification.id, id), eq(notification.recipient_id, viewerId)),
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
