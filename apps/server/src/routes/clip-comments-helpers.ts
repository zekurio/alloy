import { eq, inArray } from "drizzle-orm"
import { z } from "zod"

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
})

export const CommentIdParam = z.object({ commentId: z.uuid() })

export const authorShape = {
  id: user.id,
  username: user.username,
  displayUsername: user.displayUsername,
  name: user.name,
  image: user.image,
  imageKey: user.imageKey,
} as const

export interface CommentOut {
  id: string
  clipId: string
  parentId: string | null
  body: string
  likeCount: number
  pinned: boolean
  pinnedAt: string | null
  likedByViewer: boolean
  likedByAuthor: boolean
  createdAt: string
  editedAt: string | null
  author: {
    id: string
    username: string | null
    displayUsername: string | null
    name: string
    image: string | null
    imageKey: string | null
  }
  replies: CommentOut[]
}

export async function selectClipAccess(clipId: string) {
  const [row] = await db
    .select({
      id: clip.id,
      authorId: clip.authorId,
      status: clip.status,
      privacy: clip.privacy,
    })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ?? null
}

export async function listClipComments({
  clipId,
  sort,
  viewerId,
  clipAuthorId,
}: {
  clipId: string
  sort: "top" | "new"
  viewerId: string | null
  clipAuthorId: string
}): Promise<CommentOut[]> {
  const rows = await db
    .select({
      id: clipComment.id,
      clipId: clipComment.clipId,
      parentId: clipComment.parentId,
      body: clipComment.body,
      likeCount: clipComment.likeCount,
      pinnedAt: clipComment.pinnedAt,
      createdAt: clipComment.createdAt,
      editedAt: clipComment.editedAt,
      author: authorShape,
    })
    .from(clipComment)
    .innerJoin(user, eq(clipComment.authorId, user.id))
    .where(eq(clipComment.clipId, clipId))

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

  const byId = new Map<string, CommentOut>()
  const tops: CommentOut[] = []
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
        imageKey: r.author.imageKey,
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

  for (const t of tops) {
    t.replies.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
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
