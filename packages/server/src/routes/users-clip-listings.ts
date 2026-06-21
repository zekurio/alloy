import { user } from "@alloy/db/auth-schema"
import { clip, clipLike, clipMention, game } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { clipSelectShape, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { gameSelectShape, serialiseGameRow } from "@alloy/server/games/ref"
import { and, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm"
import type { Context } from "hono"
import { z } from "zod"

import { publicClipPrivacyCondition } from "./clips-helpers"
import { serialiseProfileGameRow } from "./games-helpers"
import type { UserRow } from "./users-helpers"
import { limitQueryParam, offsetQueryParam } from "./validation"

export const UserGamesQuery = z.object({
  limit: limitQueryParam(48, 24),
  offset: offsetQueryParam(),
})

export async function listUserClips(row: UserRow, c: Context) {
  const conditions = await visibleClipConditions(row, c, {
    includeOwnerUploads: true,
  })

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

export async function listUserGames(
  row: UserRow,
  c: Context,
  { limit, offset }: z.infer<typeof UserGamesQuery>,
) {
  const conditions = await visibleClipConditions(row, c)

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

async function visibleClipConditions(
  row: UserRow,
  c: Context,
  { includeOwnerUploads = false }: { includeOwnerUploads?: boolean } = {},
): Promise<SQL[]> {
  const session = await getSession(c)
  const isOwner = session?.user.id === row.id
  const isAdmin =
    (session?.user as { role?: string | null } | undefined)?.role === "admin"
  const canSeeUploads = includeOwnerUploads && (isOwner || isAdmin)
  const conditions: SQL[] = [
    eq(clip.authorId, row.id),
    canSeeUploads
      ? inArray(clip.status, ["pending", "processing", "ready", "failed"])
      : eq(clip.status, "ready"),
    isNull(user.disabledAt),
  ]
  if (!isOwner && !isAdmin) {
    conditions.push(publicClipPrivacyCondition())
  }
  return conditions
}

export async function listTaggedClips(row: UserRow, c: Context) {
  const session = await getSession(c)
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

export async function listLikedClips(row: UserRow, c: Context) {
  const session = await getSession(c)
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
