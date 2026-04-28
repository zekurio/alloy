import { and, eq, sql } from "drizzle-orm"

import { clip, clipComment } from "@workspace/db/schema"

import { db } from "../db"
import { getSession } from "../lib/auth/session"

export async function selectCommentModerationTarget(commentId: string) {
  const [row] = await db
    .select({
      id: clipComment.id,
      clipId: clipComment.clipId,
      authorId: clipComment.authorId,
      parentId: clipComment.parentId,
    })
    .from(clipComment)
    .where(eq(clipComment.id, commentId))
    .limit(1)
  return row ?? null
}

export async function selectClipAuthorId(clipId: string) {
  const [row] = await db
    .select({ authorId: clip.authorId })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  return row?.authorId ?? null
}

export async function canModerateComment({
  commentId,
  viewerId,
  headers,
}: {
  commentId: string
  viewerId: string
  headers: Headers
}) {
  const row = await selectCommentModerationTarget(commentId)
  if (!row) return { ok: false as const, error: "Not found", status: 404 }

  const clipAuthorId = await selectClipAuthorId(row.clipId)
  const session = await getSession(headers)
  const isAdmin =
    (session?.user as { role?: string | null } | undefined)?.role === "admin"
  const isCommentAuthor = row.authorId === viewerId
  const isClipAuthor = clipAuthorId === viewerId
  if (!isCommentAuthor && !isClipAuthor && !isAdmin) {
    return { ok: false as const, error: "Forbidden", status: 403 }
  }

  return { ok: true as const, row }
}

export async function softDeleteComment(commentId: string) {
  await db
    .update(clipComment)
    .set({
      body: "",
      pinnedAt: null,
      editedAt: new Date(),
    })
    .where(eq(clipComment.id, commentId))
}

export async function pinTopLevelComment({
  commentId,
  viewerId,
}: {
  commentId: string
  viewerId: string
}) {
  const row = await selectCommentModerationTarget(commentId)
  if (!row) return { ok: false as const, error: "Not found", status: 404 }
  if (row.parentId !== null) {
    return {
      ok: false as const,
      error: "Only top-level comments can be pinned",
      status: 400,
    }
  }

  const clipAuthorId = await selectClipAuthorId(row.clipId)
  if (!clipAuthorId)
    return { ok: false as const, error: "Not found", status: 404 }
  if (clipAuthorId !== viewerId) {
    return { ok: false as const, error: "Forbidden", status: 403 }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(clipComment)
      .set({ pinnedAt: null })
      .where(
        and(
          eq(clipComment.clipId, row.clipId),
          sql`${clipComment.pinnedAt} IS NOT NULL`
        )
      )
    await tx
      .update(clipComment)
      .set({ pinnedAt: new Date() })
      .where(eq(clipComment.id, commentId))
  })
  return { ok: true as const, row }
}

export async function unpinComment({
  commentId,
  viewerId,
}: {
  commentId: string
  viewerId: string
}) {
  const row = await selectCommentModerationTarget(commentId)
  if (!row) return { ok: false as const, error: "Not found", status: 404 }

  const clipAuthorId = await selectClipAuthorId(row.clipId)
  if (!clipAuthorId)
    return { ok: false as const, error: "Not found", status: 404 }
  if (clipAuthorId !== viewerId) {
    return { ok: false as const, error: "Forbidden", status: 403 }
  }

  await db
    .update(clipComment)
    .set({ pinnedAt: null })
    .where(eq(clipComment.id, commentId))
  return { ok: true as const }
}
