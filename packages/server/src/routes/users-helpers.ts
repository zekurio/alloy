import type { PublicUser, UserListRow, UserSummary } from "alloy-contracts"
import { user } from "alloy-db/auth-schema"
import {
  block,
  clip,
  clipLike,
  clipMention,
  follow,
  game,
} from "alloy-db/schema"
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
  sql,
} from "drizzle-orm"
import { z } from "zod"

import { getSession } from "../auth/session"
import { clipSelectShape, toPublicClipRow } from "../clips/select"
import { db } from "../db"
import { requiredSql } from "../db/sql"
import { gameSelectShape, serialiseGameRow } from "../games/ref"
import { isoDate } from "../runtime/date"
import { serialiseProfileGameRow } from "./games-helpers"
import {
  limitQueryParam,
  offsetQueryParam,
  requiredTrimmedString,
} from "./validation"

export const UsernameParam = z.object({ username: z.string().min(1) })

export const SearchQuery = z.object({
  q: requiredTrimmedString(64),
  limit: limitQueryParam(20, 8),
})

export const UserGamesQuery = z.object({
  limit: limitQueryParam(48, 24),
  offset: offsetQueryParam(),
})

export function toLikePattern(raw: string): string {
  const escaped = raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
  return `%${escaped}%`
}

export const userSummarySelectShape = {
  id: user.id,
  username: user.username,
  displayUsername: user.displayUsername,
  name: user.name,
  image: user.image,
}

type UserSummaryFields = Pick<
  typeof user.$inferSelect,
  "id" | "username" | "displayUsername" | "name" | "image"
>

export function serialiseUserSummary(row: UserSummaryFields): UserSummary {
  return {
    id: row.id,
    username: row.username,
    displayUsername: row.displayUsername,
    name: row.name,
    image: row.image,
  }
}

export function serialiseNullableUserSummary(row: {
  id: string | null
  username: string | null
  displayUsername: string | null
  name: string | null
  image: string | null
}): UserSummary | null {
  if (!row.id) return null
  return serialiseUserSummary({
    id: row.id,
    username: row.username ?? "",
    displayUsername: row.displayUsername ?? "",
    name: row.name ?? "",
    image: row.image,
  })
}

export function serialiseUserListRow(
  row: UserSummaryFields & { createdAt: Date | string; clipCount: number },
): UserListRow {
  return {
    ...serialiseUserSummary(row),
    createdAt: isoDate(row.createdAt),
    clipCount: row.clipCount,
  }
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
    requiredSql(
      or(
        ilike(user.name, pattern),
        ilike(user.displayUsername, pattern),
        ilike(user.username, pattern),
      ),
      "user search text filter",
    ),
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

  const rows = await db
    .select({
      ...userSummarySelectShape,
    })
    .from(user)
    .where(and(...conditions))
    .orderBy(user.username)
    .limit(limit)

  return rows.map(serialiseUserSummary)
}

export type UserRow = typeof user.$inferSelect

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name ?? "",
    image: row.image,
    banner: row.banner,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  }
}

export async function resolveTarget(segment: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(
      and(
        eq(sql`lower(${user.username})`, segment.toLowerCase()),
        isNull(user.disabledAt),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function listUserClips(row: UserRow, headers: Headers) {
  const conditions = await visibleReadyClipConditions(row, headers)

  const rows = await db
    .select(clipSelectShape)
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
    .where(and(...conditions))
    .orderBy(desc(clip.createdAt))
    .limit(50)
  return rows.map(toPublicClipRow)
}

export async function listUserGames(
  row: UserRow,
  headers: Headers,
  { limit, offset }: z.infer<typeof UserGamesQuery>,
) {
  const conditions = await visibleReadyClipConditions(row, headers)

  const lastClippedAt = sql<Date>`max(${clip.createdAt})`

  const rows = await db
    .select({
      ...gameSelectShape,
      clipCount: sql<number>`count(${clip.id})::int`,
      lastClippedAt,
    })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
    .where(and(...conditions))
    .groupBy(game.steamgriddbId)
    .orderBy(sql`${lastClippedAt} desc`, game.name)
    .limit(limit)
    .offset(offset)

  const enriched = rows.map((row) => ({
    ...serialiseGameRow(row),
    clipCount: row.clipCount,
    lastClippedAt: row.lastClippedAt,
  }))

  return enriched.map(serialiseProfileGameRow)
}

async function visibleReadyClipConditions(
  row: UserRow,
  headers: Headers,
): Promise<SQL[]> {
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
  return conditions
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

  const rows = await db
    .select(clipSelectShape)
    .from(clipMention)
    .innerJoin(clip, eq(clipMention.clipId, clip.id))
    .innerJoin(user, eq(clip.authorId, user.id))
    .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
    .where(and(...conditions))
    .orderBy(desc(clip.createdAt))
    .limit(50)
  return rows.map(toPublicClipRow)
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

  const rows = await db
    .select(clipSelectShape)
    .from(clipLike)
    .innerJoin(clip, eq(clipLike.clipId, clip.id))
    .innerJoin(user, eq(clip.authorId, user.id))
    .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
    .where(and(...conditions))
    .orderBy(desc(clipLike.createdAt))
    .limit(50)
  return rows.map(toPublicClipRow)
}

export async function listFollowers(row: UserRow) {
  const rows = await db
    .select({
      ...userSummarySelectShape,
    })
    .from(follow)
    .innerJoin(user, eq(user.id, follow.followerId))
    .where(and(eq(follow.followingId, row.id), isNull(user.disabledAt)))
    .orderBy(user.username)
    .limit(200)
  return rows.map(serialiseUserSummary)
}

export async function listFollowing(row: UserRow) {
  const rows = await db
    .select({
      ...userSummarySelectShape,
    })
    .from(follow)
    .innerJoin(user, eq(user.id, follow.followingId))
    .where(and(eq(follow.followerId, row.id), isNull(user.disabledAt)))
    .orderBy(user.username)
    .limit(200)
  return rows.map(serialiseUserSummary)
}

export async function resolveViewerState(
  viewerId: string | null,
  targetId: string,
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
        and(eq(follow.followerId, viewerId), eq(follow.followingId, targetId)),
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
          and(eq(block.blockerId, targetId), eq(block.blockedId, viewerId)),
        ),
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
  { includeRestrictedClips }: { includeRestrictedClips: boolean },
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
