import { user } from "@alloy/db/auth-schema"
import { clip, clipLike, clipMention, game } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { clipSelectShape, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { gameSelectShape, serialiseGameRow } from "@alloy/server/games/ref"
import { and, desc, eq, isNull, type SQL, sql } from "drizzle-orm"
import { z } from "zod"

import { publicClipPrivacyCondition } from "./clips-helpers"
import { serialiseProfileGameRow } from "./games-helpers"
import type { UserRow } from "./users-helpers"
import { limitQueryParam, offsetQueryParam } from "./validation"

export const UserTopClipsQuery = z.object({
  limit: limitQueryParam(24, 5),
})

export const UserGamesQuery = z.object({
  limit: limitQueryParam(48, 24),
  offset: offsetQueryParam(),
})

export async function listUserClips(row: UserRow, headers: Headers) {
  const conditions = await visibleReadyClipConditions(row, headers)

  const rows = await db
    .select(clipSelectShape)
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
    .where(and(...conditions))
    .orderBy(desc(clip.createdAt))
    .limit(50)
  return rows.map(toPublicClipRow)
}

export async function listUserTopClips(
  row: UserRow,
  { limit }: z.infer<typeof UserTopClipsQuery>,
) {
  const rows = await db
    .select(clipSelectShape)
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
    .where(
      and(
        eq(clip.authorId, row.id),
        eq(clip.status, "ready"),
        eq(clip.privacy, "public"),
        isNull(user.disabledAt),
      ),
    )
    .orderBy(
      desc(clip.viewCount),
      desc(clip.likeCount),
      desc(clip.createdAt),
      clip.id,
    )
    .limit(limit)
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
    conditions.push(publicClipPrivacyCondition())
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
    conditions.push(publicClipPrivacyCondition())
  }

  const rows = await db
    .select(clipSelectShape)
    .from(clipMention)
    .innerJoin(clip, eq(clipMention.clipId, clip.id))
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
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
  if (!isAdmin && !isOwner) {
    // Liking required link access, so owners keep unlisted clips in their own
    // list; everyone else only sees the public ones.
    conditions.push(publicClipPrivacyCondition())
  }

  const rows = await db
    .select(clipSelectShape)
    .from(clipLike)
    .innerJoin(clip, eq(clipLike.clipId, clip.id))
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
    .where(and(...conditions))
    .orderBy(desc(clipLike.createdAt))
    .limit(50)
  return rows.map(toPublicClipRow)
}
