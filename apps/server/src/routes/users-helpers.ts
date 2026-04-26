import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm"
import { z } from "zod"

import type { PublicUser } from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import {
  block,
  clip,
  clipLike,
  clipMention,
  follow,
  game,
} from "@workspace/db/schema"

import { db } from "../db"
import { getSession } from "../lib/auth/session"
import { clipSelectShape } from "../lib/clip-select"

export const UsernameParam = z.object({ username: z.string().min(1) })

export const SearchQuery = z.object({
  q: z.string().min(1).max(64),
  limit: z.coerce.number().int().positive().max(20).default(8),
})

export function toLikePattern(raw: string): string {
  const escaped = raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
  return `%${escaped}%`
}

export async function searchVisibleUsers({
  q,
  limit,
  viewerId,
}: {
  q: string
  limit: number
  viewerId: string | null
}) {
  const pattern = toLikePattern(q.trim())
  const conditions: SQL[] = [
    or(
      ilike(user.name, pattern),
      ilike(user.displayUsername, pattern),
      ilike(user.username, pattern)
    )!,
  ]
  if (viewerId) {
    conditions.push(ne(user.id, viewerId))
    const blockRows = await db
      .select({
        blockerId: block.blockerId,
        blockedId: block.blockedId,
      })
      .from(block)
      .where(or(eq(block.blockerId, viewerId), eq(block.blockedId, viewerId)))
    const excluded = new Set<string>()
    for (const row of blockRows) {
      excluded.add(row.blockerId === viewerId ? row.blockedId : row.blockerId)
    }
    if (excluded.size > 0) {
      conditions.push(notInArray(user.id, [...excluded]))
    }
  }
  conditions.push(isNull(user.disabledAt))

  return db
    .select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      image: user.image,
    })
    .from(user)
    .where(and(...conditions))
    .orderBy(user.username)
    .limit(limit)
}

export type UserRow = typeof user.$inferSelect

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name ?? "",
    image: row.image,
    banner: row.banner,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function resolveTarget(segment: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(
      and(eq(user.username, segment.toLowerCase()), isNull(user.disabledAt))
    )
    .limit(1)
  return row ?? null
}

export async function listUserClips(row: UserRow, headers: Headers) {
  const session = await getSession(headers)
  const isOwner = session?.user.id === row.id
  const isAdmin =
    (session?.user as { role?: string | null } | undefined)?.role === "admin"
  const conditions: SQL[] = [
    eq(clip.authorId, row.id),
    eq(clip.status, "ready"),
    isNull(user.disabledAt),
  ]
  if (!isOwner && !isAdmin) {
    conditions.push(inArray(clip.privacy, ["public", "unlisted"]))
  }

  return db
    .select(clipSelectShape)
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.gameId, game.id))
    .where(and(...conditions))
    .orderBy(desc(clip.createdAt))
    .limit(50)
}

export async function listTaggedClips(row: UserRow, headers: Headers) {
  const session = await getSession(headers)
  const isAdmin =
    (session?.user as { role?: string | null } | undefined)?.role === "admin"

  const conditions: SQL[] = [
    eq(clipMention.mentionedUserId, row.id),
    eq(clip.status, "ready"),
    isNull(user.disabledAt),
  ]
  if (!isAdmin) {
    conditions.push(inArray(clip.privacy, ["public", "unlisted"]))
  }

  return db
    .select(clipSelectShape)
    .from(clipMention)
    .innerJoin(clip, eq(clipMention.clipId, clip.id))
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.gameId, game.id))
    .where(and(...conditions))
    .orderBy(desc(clip.createdAt))
    .limit(50)
}

export async function listLikedClips(row: UserRow, headers: Headers) {
  const session = await getSession(headers)
  const isOwner = session?.user.id === row.id
  const isAdmin =
    (session?.user as { role?: string | null } | undefined)?.role === "admin"

  const conditions: SQL[] = [
    eq(clipLike.userId, row.id),
    eq(clip.status, "ready"),
    isNull(user.disabledAt),
  ]
  if (!isOwner && !isAdmin) {
    conditions.push(inArray(clip.privacy, ["public", "unlisted"]))
  }

  return db
    .select(clipSelectShape)
    .from(clipLike)
    .innerJoin(clip, eq(clipLike.clipId, clip.id))
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.gameId, game.id))
    .where(and(...conditions))
    .orderBy(desc(clipLike.createdAt))
    .limit(50)
}

export function listFollowers(row: UserRow) {
  return db
    .select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      image: user.image,
    })
    .from(follow)
    .innerJoin(user, eq(user.id, follow.followerId))
    .where(and(eq(follow.followingId, row.id), isNull(user.disabledAt)))
    .orderBy(user.username)
    .limit(200)
}

export function listFollowing(row: UserRow) {
  return db
    .select({
      id: user.id,
      username: user.username,
      displayUsername: user.displayUsername,
      name: user.name,
      image: user.image,
    })
    .from(follow)
    .innerJoin(user, eq(user.id, follow.followingId))
    .where(and(eq(follow.followerId, row.id), isNull(user.disabledAt)))
    .orderBy(user.username)
    .limit(200)
}

export async function resolveViewerState(
  viewerId: string | null,
  targetId: string
): Promise<{
  isSelf: boolean
  isFollowing: boolean
  isBlocked: boolean
  isBlockedBy: boolean
} | null> {
  if (!viewerId) return null

  const isSelf = viewerId === targetId
  if (isSelf) {
    return {
      isSelf: true,
      isFollowing: false,
      isBlocked: false,
      isBlockedBy: false,
    }
  }

  const [followRow, blockRows] = await Promise.all([
    db
      .select({ id: follow.id })
      .from(follow)
      .where(
        and(eq(follow.followerId, viewerId), eq(follow.followingId, targetId))
      )
      .limit(1),
    db
      .select({
        blockerId: block.blockerId,
        blockedId: block.blockedId,
      })
      .from(block)
      .where(
        or(
          and(eq(block.blockerId, viewerId), eq(block.blockedId, targetId)),
          and(eq(block.blockerId, targetId), eq(block.blockedId, viewerId))
        )
      ),
  ])

  return {
    isSelf: false,
    isFollowing: followRow.length > 0,
    isBlocked: blockRows.some((b) => b.blockerId === viewerId),
    isBlockedBy: blockRows.some((b) => b.blockerId === targetId),
  }
}

export async function selectProfileCounts(
  targetId: string,
  { includeRestrictedClips }: { includeRestrictedClips: boolean }
) {
  const clipConditions: SQL[] = [
    eq(clip.authorId, targetId),
    eq(clip.status, "ready"),
  ]
  if (!includeRestrictedClips) {
    clipConditions.push(inArray(clip.privacy, ["public", "unlisted"]))
  }

  const [
    [{ value: clipCount }],
    [{ value: followerCount }],
    [{ value: followingCount }],
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(clip)
      .where(and(...clipConditions)),
    db
      .select({ value: count() })
      .from(follow)
      .where(eq(follow.followingId, targetId)),
    db
      .select({ value: count() })
      .from(follow)
      .where(eq(follow.followerId, targetId)),
  ])

  return {
    clips: clipCount,
    followers: followerCount,
    following: followingCount,
  }
}
