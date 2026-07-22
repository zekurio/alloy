import { clip, clipComment } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { db } from "@alloy/server/db/index"
import { and, eq, sql } from "drizzle-orm"
import type { Context } from "hono"

async function selectCommentModerationTarget(commentId: string) {
  const [row] = await db
    .select({
      id: clipComment.id,
      clipId: clipComment.clip_id,
      authorId: clipComment.author_id,
      parentId: clipComment.parent_id,
    })
    .from(clipComment)
    .where(eq(clipComment.id, commentId))
    .limit(1)
  return row ?? null
}

async function selectClipAuthorId(clipId: string) {
  const [row] = await db
    .select({ authorId: clip.author_id })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  return row?.authorId ?? null
}

async function loadModerationTarget(commentId: string) {
  const row = await selectCommentModerationTarget(commentId)
  if (!row) {
    return { ok: false as const, error: "Not found", status: 404 as const }
  }
  return { ok: true as const, row }
}

async function requireClipOwner(clipId: string, viewerId: string) {
  const clipAuthorId = await selectClipAuthorId(clipId)
  if (!clipAuthorId) {
    return { ok: false as const, error: "Not found", status: 404 as const }
  }
  if (clipAuthorId !== viewerId) {
    return { ok: false as const, error: "Forbidden", status: 403 as const }
  }
  return { ok: true as const }
}

export async function canModerateComment({
  commentId,
  viewerId,
  c,
}: {
  commentId: string
  viewerId: string
  c: Context
}) {
  const target = await loadModerationTarget(commentId)
  if (!target.ok) return target
  const { row } = target

  const clipAuthorId = await selectClipAuthorId(row.clipId)
  const session = await getSession(c)
  const isAdmin = session?.user.role === "admin"
  const isCommentAuthor = row.authorId === viewerId
  const isClipAuthor = clipAuthorId === viewerId
  if (!isCommentAuthor && !isClipAuthor && !isAdmin) {
    return { ok: false as const, error: "Forbidden", status: 403 as const }
  }

  return { ok: true as const, row }
}

export async function softDeleteComment(commentId: string) {
  await db
    .update(clipComment)
    .set({
      body: "",
      pinned_at: null,
      edited_at: new Date(),
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
  const target = await loadModerationTarget(commentId)
  if (!target.ok) return target
  const { row } = target
  if (row.parentId !== null) {
    return {
      ok: false as const,
      error: "Only top-level comments can be pinned",
      status: 400 as const,
    }
  }

  const owner = await requireClipOwner(row.clipId, viewerId)
  if (!owner.ok) return owner

  await db.transaction(async (tx) => {
    await tx
      .update(clipComment)
      .set({ pinned_at: null })
      .where(
        and(
          eq(clipComment.clip_id, row.clipId),
          sql`${clipComment.pinned_at} IS NOT NULL`,
        ),
      )
    await tx
      .update(clipComment)
      .set({ pinned_at: new Date() })
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
  const target = await loadModerationTarget(commentId)
  if (!target.ok) return target

  const owner = await requireClipOwner(target.row.clipId, viewerId)
  if (!owner.ok) return owner

  await db
    .update(clipComment)
    .set({ pinned_at: null })
    .where(eq(clipComment.id, commentId))
  return { ok: true as const }
}
