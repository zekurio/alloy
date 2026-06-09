import type { GameListRow } from "alloy-contracts"
import { user } from "alloy-db/auth-schema"
import { clip, game } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { clipSelectShape, toPublicClipRow } from "../clips/select"
import { db } from "../db"
import {
  gameSelectShape,
  getSteamGridGameRefOrSnapshot,
  serialiseGameRow,
} from "../games/ref"
import { searchGames } from "../games/steamgriddb"
import { serialiseGameListRow } from "./games-helpers"
import {
  serialiseUserListRow,
  toLikePattern,
  userSummarySelectShape,
} from "./users-helpers"
import {
  limitQueryParam,
  requiredTrimmedString,
  zValidator,
} from "./validation"

const SearchQuery = z.object({
  q: requiredTrimmedString(120),
  limit: limitQueryParam(20, 8),
})

function visibleGameClipConditions() {
  return [
    eq(clip.status, "ready"),
    inArray(clip.privacy, ["public", "unlisted"]),
    isNull(user.disabledAt),
  ]
}

async function countVisibleClipsBySteamGridId(
  steamgriddbIds: number[],
): Promise<
  Map<number, { steamgriddbId: number; name: string | null; clipCount: number }>
> {
  if (steamgriddbIds.length === 0) return new Map()
  const rows = await db
    .select({
      steamgriddbId: clip.steamgriddbId,
      name: sql<string | null>`min(${clip.game})`,
      clipCount: sql<number>`count(${clip.id})::int`,
    })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(
      and(
        ...visibleGameClipConditions(),
        inArray(clip.steamgriddbId, steamgriddbIds),
      ),
    )
    .groupBy(clip.steamgriddbId)

  return new Map(rows.map((row) => [row.steamgriddbId, row]))
}

async function searchSteamGridGames(
  q: string,
  limit: number,
): Promise<GameListRow[]> {
  try {
    const results = await searchGames(q)
    const ids = results.map((row) => row.id)
    const counts = await countVisibleClipsBySteamGridId(ids)
    const rows: GameListRow[] = []

    for (const result of results) {
      const countRow = counts.get(result.id)
      if (!countRow) continue
      const ref = await getSteamGridGameRefOrSnapshot({
        steamgriddbId: result.id,
        name: countRow.name ?? result.name,
      })
      rows.push(serialiseGameListRow({ ...ref, clipCount: countRow.clipCount }))
      if (rows.length >= limit) break
    }

    return rows
  } catch (err) {
    logger.warn("[search] SteamGridDB game search failed:", err)
    return []
  }
}

async function searchLocalGameSnapshots(
  pattern: string,
  limit: number,
): Promise<GameListRow[]> {
  const rows = await db
    .select({
      ...gameSelectShape,
      clipCount: sql<number>`count(${clip.id})::int`,
    })
    .from(game)
    .innerJoin(clip, eq(clip.steamgriddbId, game.steamgriddbId))
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(
      and(
        ...visibleGameClipConditions(),
        or(
          ilike(game.name, pattern),
          ilike(game.slug, pattern),
          ilike(clip.game, pattern),
        ),
      ),
    )
    .groupBy(game.steamgriddbId)
    .orderBy(sql`count(${clip.id}) desc`, game.name)
    .limit(limit)

  return rows.map((row) =>
    serialiseGameListRow({
      ...serialiseGameRow(row),
      clipCount: row.clipCount,
    }),
  )
}

function mergeGameResults(
  primary: GameListRow[],
  fallback: GameListRow[],
  limit: number,
): GameListRow[] {
  const seen = new Set<number>()
  const merged: GameListRow[] = []
  for (const row of [...primary, ...fallback]) {
    if (seen.has(row.steamgriddbId)) continue
    seen.add(row.steamgriddbId)
    merged.push(row)
    if (merged.length >= limit) break
  }
  return merged
}

export const searchRoute = new Hono().get(
  "/",
  zValidator("query", SearchQuery),
  async (c) => {
    const { q, limit } = c.req.valid("query")
    const pattern = toLikePattern(q)

    const matchRank = sql<number>`CASE
      WHEN ${clip.title} ILIKE ${pattern} THEN 0
      WHEN ${user.name} ILIKE ${pattern}
        OR ${user.displayUsername} ILIKE ${pattern}
        OR ${user.username} ILIKE ${pattern} THEN 1
      WHEN ${game.name} ILIKE ${pattern}
        OR ${clip.game} ILIKE ${pattern} THEN 2
      WHEN ${clip.description} ILIKE ${pattern} THEN 3
      ELSE 4
    END`

    const [clips, steamGridGames, localGames, users] = await Promise.all([
      db
        .select(clipSelectShape)
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
        .where(
          and(
            eq(clip.status, "ready"),
            inArray(clip.privacy, ["public", "unlisted"]),
            isNull(user.disabledAt),
            or(
              ilike(clip.title, pattern),
              ilike(clip.description, pattern),
              ilike(user.name, pattern),
              ilike(user.displayUsername, pattern),
              ilike(user.username, pattern),
              ilike(game.name, pattern),
              ilike(clip.game, pattern),
            ),
          ),
        )
        .orderBy(matchRank, desc(clip.createdAt))
        .limit(limit),

      searchSteamGridGames(q, limit),
      searchLocalGameSnapshots(pattern, limit),

      db
        .select({
          ...userSummarySelectShape,
          createdAt: user.createdAt,
          clipCount: sql<number>`count(${clip.id})::int`,
        })
        .from(user)
        .leftJoin(
          clip,
          and(
            eq(clip.authorId, user.id),
            eq(clip.status, "ready"),
            inArray(clip.privacy, ["public", "unlisted"]),
          ),
        )
        .where(
          and(
            or(
              ilike(user.name, pattern),
              ilike(user.displayUsername, pattern),
              ilike(user.username, pattern),
            ),
            isNull(user.disabledAt),
          ),
        )
        .groupBy(user.id)
        .orderBy(sql`count(${clip.id}) desc`, user.username)
        .limit(limit),
    ])

    return c.json({
      clips: clips.map(toPublicClipRow),
      games: mergeGameResults(steamGridGames, localGames, limit),
      users: users.map(serialiseUserListRow),
    })
  },
)
