import { Buffer } from "node:buffer"

import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"

import type { CommentPage, CommentRow } from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip, clipComment, clipCommentLike } from "@workspace/db/schema"

import { db } from "../db"

export const BODY_MAX = 2000

export const CreateBody = z.object({
  body: z.string().trim().min(1).max(BODY_MAX),
  parentId: z.uuid().optional(),
})

export const UpdateBody = z.object({
  body: z.string().trim().min(1).max(BODY_MAX),
})

export const ListQuery = z.object({
  sort: z.enum(["top", "new"]).default("top"),
  limit: z.coerce.number().int().positive().max(100).default(30),
  cursor: z.string().optional(),
})

export const CommentIdParam = z.object({ commentId: z.uuid() })

export const authorShape = {
  id: user.id,
  username: user.username,
  displayUsername: user.displayUsername,
  name: user.name,
  image: user.image,
} as const

export async function selectClipAccess(clipId: string) {
  const [row] = await db
    .select({
      id: clip.id,
      authorId: clip.authorId,
      status: clip.status,
      privacy: clip.privacy,
      authorDisabledAt: user.disabledAt,
    })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ?? null
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
    throw new Error("Invalid cursor")
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
  author: authorShape,
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
  author: {
    id: string
    username: string
    displayUsername: string
    name: string
    image: string | null
  }
}

type CommentCursor = {
  pinned: boolean
  likeCount: number
  createdAt: string
  id: string
}

function parseCommentCursor(value: string | undefined): CommentCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<CommentCursor>
    if (
      typeof parsed.pinned !== "boolean" ||
      typeof parsed.likeCount !== "number" ||
      !Number.isFinite(parsed.likeCount) ||
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== "string"
    ) {
      return null
    }
    return {
      pinned: parsed.pinned,
      likeCount: parsed.likeCount,
      createdAt: parsed.createdAt,
      id: parsed.id,
    }
  } catch {
    return null
  }
}

function encodeCommentCursor(row: CommentRowRecord): string {
  return Buffer.from(
    JSON.stringify({
      pinned: row.pinnedAt !== null,
      likeCount: row.likeCount,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
      id: row.id,
    } satisfies CommentCursor),
    "utf8"
  ).toString("base64url")
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
  const createdAt = new Date(cursor.createdAt)
  const pinnedRank = sql<number>`case when ${clipComment.pinnedAt} is null then 0 else 1 end`
  const afterCreatedAt = or(
    sql`${clipComment.createdAt} < ${createdAt}`,
    and(
      eq(clipComment.createdAt, createdAt),
      sql`${clipComment.id} > ${cursor.id}`
    )
  )
  const afterSort =
    sort === "top"
      ? or(
          sql`${clipComment.likeCount} < ${cursor.likeCount}`,
          and(eq(clipComment.likeCount, cursor.likeCount), afterCreatedAt)
        )
      : afterCreatedAt
  return or(
    sql`${pinnedRank} < ${pinnedValue}`,
    and(sql`${pinnedRank} = ${pinnedValue}`, afterSort)
  )
}

async function buildCommentTree(
  rows: CommentRowRecord[],
  viewerId: string | null,
  clipAuthorId: string,
  sort: "top" | "new"
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
      pinnedAt:
        r.pinnedAt instanceof Date ? r.pinnedAt.toISOString() : r.pinnedAt,
      likedByViewer: likedByViewer.has(r.id),
      likedByAuthor: likedByAuthor.has(r.id),
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      editedAt:
        r.editedAt instanceof Date ? r.editedAt.toISOString() : r.editedAt,
      author: {
        id: r.author.id,
        username: r.author.username,
        displayUsername: r.author.displayUsername,
        name: r.author.name,
        image: r.author.image,
      },
      replies: [],
    })
  }
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.replies.push(node)
    } else {
      tops.push(node)
    }
  }

  const sortReplies = (comment: CommentRow) => {
    comment.replies.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
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
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  return tops
}
