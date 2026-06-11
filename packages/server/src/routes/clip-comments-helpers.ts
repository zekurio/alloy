import {
  COMMENT_BODY_MAX_LENGTH,
  type CommentPage,
  type CommentRow,
  type UserSummary,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clipComment, clipCommentLike } from "@alloy/db/schema"
import { resolveClipAccess } from "@alloy/server/clips/access"
import { db } from "@alloy/server/db/index"
import {
  dateLikeTime,
  isoDate,
  nullableIsoDate,
} from "@alloy/server/runtime/date"
import { and, desc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm"
import { z } from "zod"

import {
  cursorDate,
  cursorNonNegativeInteger,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import { serialiseUserSummary, userSummarySelectShape } from "./users-helpers"
import { limitQueryParam, requiredTrimmedString } from "./validation"

export const CreateBody = z.object({
  body: requiredTrimmedString(COMMENT_BODY_MAX_LENGTH),
  parentId: z.uuid().optional(),
})

export const UpdateBody = z.object({
  body: requiredTrimmedString(COMMENT_BODY_MAX_LENGTH),
})

export const ListQuery = z.object({
  sort: z.enum(["top", "new"]).default("top"),
  limit: limitQueryParam(100, 30),
  cursor: z.string().optional(),
})

export const CommentIdParam = z.object({ commentId: z.uuid() })

export class InvalidCommentCursorError extends Error {
  constructor() {
    super("Invalid cursor")
    this.name = "InvalidCommentCursorError"
  }
}

export async function resolveCommentEngagementTarget(
  commentId: string,
  headers: Headers,
) {
  const [row] = await db
    .select({ clipId: clipComment.clipId })
    .from(clipComment)
    .where(eq(clipComment.id, commentId))
    .limit(1)
  if (!row) {
    return {
      accessible: false as const,
      error: "Not found",
      status: 404 as const,
      isPrivate: false,
    }
  }
  const target = await resolveClipAccess({
    id: row.clipId,
    headers,
    policy: "engagement",
  })
  if (!target.accessible) return target
  return { accessible: true as const }
}

export async function listClipComments({
  clipId,
  sort,
  limit,
  cursor,
  viewerId,
  clipAuthorId,
}: {
  clipId: string
  sort: "top" | "new"
  limit: number
  cursor: string | undefined
  viewerId: string | null
  clipAuthorId: string
}): Promise<CommentPage> {
  const parsedCursor = parseCommentCursor(cursor)
  if (cursor && !parsedCursor) {
    throw new InvalidCommentCursorError()
  }

  const topLevelConditions: SQL[] = [
    eq(clipComment.clipId, clipId),
    isNull(clipComment.parentId),
  ]
  const cursorCondition = parsedCursor
    ? commentCursorCondition(parsedCursor, sort)
    : undefined
  if (cursorCondition) topLevelConditions.push(cursorCondition)

  const pageRows = await db
    .select(commentSelectShape)
    .from(clipComment)
    .innerJoin(user, eq(clipComment.authorId, user.id))
    .where(and(...topLevelConditions))
    .orderBy(...commentOrderBy(sort))
    .limit(limit + 1)

  const pageItems = pageRows.slice(0, limit)
  const topIds = pageItems.map((r) => r.id)
  const rows = [...pageItems]
  const frontier = [...topIds]
  const seen = new Set(topIds)

  while (frontier.length > 0 && seen.size < 1000) {
    const batch = frontier.splice(0, frontier.length)
    const descendants = await db
      .select(commentSelectShape)
      .from(clipComment)
      .innerJoin(user, eq(clipComment.authorId, user.id))
      .where(inArray(clipComment.parentId, batch))
      .orderBy(desc(clipComment.createdAt), clipComment.id)
    for (const row of descendants) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
      frontier.push(row.id)
    }
  }

  const tail = pageItems[pageItems.length - 1]
  const nextCursor =
    pageRows.length > limit && tail ? encodeCommentCursor(tail) : null

  return {
    items: await buildCommentTree(rows, viewerId, clipAuthorId, sort),
    nextCursor,
  }
}

const commentSelectShape = {
  id: clipComment.id,
  clipId: clipComment.clipId,
  parentId: clipComment.parentId,
  body: clipComment.body,
  likeCount: clipComment.likeCount,
  pinnedAt: clipComment.pinnedAt,
  createdAt: clipComment.createdAt,
  editedAt: clipComment.editedAt,
  author: userSummarySelectShape,
} as const

type CommentRowRecord = {
  id: string
  clipId: string
  parentId: string | null
  body: string
  likeCount: number
  pinnedAt: Date | null
  createdAt: Date
  editedAt: Date | null
  author: UserSummary
}

type CommentCursor = {
  pinned: boolean
  likeCount: number
  createdAt: Date
  id: string
}

type CommentCursorPayload = {
  pinned: boolean
  likeCount: number
  createdAt: string
  id: string
}

function parseCommentCursor(value: string | undefined): CommentCursor | null {
  if (!value) return null
  const parsed = decodeCursorPayload(value)
  if (!parsed) return null
  const likeCount = cursorNonNegativeInteger(parsed.likeCount)
  const createdAt = cursorDate(parsed.createdAt)
  const id = cursorRequiredString(parsed.id)
  if (
    typeof parsed.pinned !== "boolean" ||
    likeCount === null ||
    !createdAt ||
    !id
  ) {
    return null
  }
  return {
    pinned: parsed.pinned,
    likeCount,
    createdAt,
    id,
  }
}

function encodeCommentCursor(row: CommentRowRecord): string {
  return encodeCursorPayload({
    pinned: row.pinnedAt !== null,
    likeCount: row.likeCount,
    createdAt: isoDate(row.createdAt),
    id: row.id,
  } satisfies CommentCursorPayload)
}

function commentOrderBy(sort: "top" | "new") {
  const pinnedRank = sql<number>`case when ${clipComment.pinnedAt} is null then 0 else 1 end`
  return sort === "top"
    ? [
        sql`${pinnedRank} desc`,
        desc(clipComment.likeCount),
        desc(clipComment.createdAt),
        clipComment.id,
      ]
    : [sql`${pinnedRank} desc`, desc(clipComment.createdAt), clipComment.id]
}

function commentCursorCondition(cursor: CommentCursor, sort: "top" | "new") {
  const pinnedValue = cursor.pinned ? 1 : 0
  const pinnedRank = sql<number>`case when ${clipComment.pinnedAt} is null then 0 else 1 end`
  const afterCreatedAt = or(
    sql`${clipComment.createdAt} < ${cursor.createdAt}`,
    and(
      eq(clipComment.createdAt, cursor.createdAt),
      sql`${clipComment.id} > ${cursor.id}`,
    ),
  )
  const afterSort =
    sort === "top"
      ? or(
          sql`${clipComment.likeCount} < ${cursor.likeCount}`,
          and(eq(clipComment.likeCount, cursor.likeCount), afterCreatedAt),
        )
      : afterCreatedAt
  return or(
    sql`${pinnedRank} < ${pinnedValue}`,
    and(sql`${pinnedRank} = ${pinnedValue}`, afterSort),
  )
}

async function buildCommentTree(
  rows: CommentRowRecord[],
  viewerId: string | null,
  clipAuthorId: string,
  sort: "top" | "new",
): Promise<CommentRow[]> {
  const ids = rows.map((r) => r.id)
  const likedByViewer = new Set<string>()
  const likedByAuthor = new Set<string>()
  if (ids.length > 0) {
    const likes = await db
      .select({
        commentId: clipCommentLike.commentId,
        userId: clipCommentLike.userId,
      })
      .from(clipCommentLike)
      .where(inArray(clipCommentLike.commentId, ids))
    for (const l of likes) {
      if (l.userId === clipAuthorId) likedByAuthor.add(l.commentId)
      if (viewerId && l.userId === viewerId) likedByViewer.add(l.commentId)
    }
  }

  const byId = new Map<string, CommentRow>()
  const tops: CommentRow[] = []
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      clipId: r.clipId,
      parentId: r.parentId,
      body: r.body,
      likeCount: r.likeCount,
      pinned: r.pinnedAt !== null,
      pinnedAt: nullableIsoDate(r.pinnedAt),
      likedByViewer: likedByViewer.has(r.id),
      likedByAuthor: likedByAuthor.has(r.id),
      createdAt: isoDate(r.createdAt),
      editedAt: nullableIsoDate(r.editedAt),
      author: serialiseUserSummary(r.author),
      replies: [],
    })
  }
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null
    if (parent) {
      parent.replies.push(node)
    } else {
      tops.push(node)
    }
  }

  const sortReplies = (comment: CommentRow) => {
    comment.replies.sort(
      (a, b) => dateLikeTime(a.createdAt) - dateLikeTime(b.createdAt),
    )
    for (const reply of comment.replies) sortReplies(reply)
  }
  for (const t of tops) {
    sortReplies(t)
  }
  tops.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (sort === "top") {
      if (b.likeCount !== a.likeCount) return b.likeCount - a.likeCount
    }
    return dateLikeTime(b.createdAt) - dateLikeTime(a.createdAt)
  })

  return tops
}
