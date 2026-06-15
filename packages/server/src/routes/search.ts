import type { GameListRow } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { clipSelectShape, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { searchGames } from "@alloy/server/games/igdb"
import {
  gameSelectShape,
  getIGDBGameRefOrSnapshot,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { publicClipPrivacyCondition } from "./clips-helpers"
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

const logger = createLogger("search")

const SearchQuery = z.object({
  q: requiredTrimmedString(120),
  limit: limitQueryParam(20, 8),
})

function visibleGameClipConditions() {
  return [
    eq(clip.status, "ready"),
    publicClipPrivacyCondition(),
    isNull(user.disabledAt),
  ]
}

async function countVisibleClipsByIGDBId(
  igdbIds: number[],
): Promise<
  Map<number, { igdbId: number; name: string | null; clipCount: number }>
> {
  if (igdbIds.length === 0) return new Map()
  const rows = await db
    .select({
      igdbId: clip.igdbId,
      name: sql<string | null>`min(${clip.game})`,
      clipCount: sql<number>`count(${clip.id})::int`,
    })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(and(...visibleGameClipConditions(), inArray(clip.igdbId, igdbIds)))
    .groupBy(clip.igdbId)

  const counts = new Map<
    number,
    { igdbId: number; name: string | null; clipCount: number }
  >()
  for (const row of rows) {
    if (row.igdbId === null) continue
    counts.set(row.igdbId, {
      igdbId: row.igdbId,
      name: row.name,
      clipCount: row.clipCount,
    })
  }
  return counts
}

async function searchIGDBGames(
  q: string,
  limit: number,
): Promise<GameListRow[]> {
  try {
    const results = await searchGames(q)
    const ids = results.map((row) => row.id)
    const counts = await countVisibleClipsByIGDBId(ids)
    const rows: GameListRow[] = []

    for (const result of results) {
      const countRow = counts.get(result.id)
      if (!countRow) continue
      const ref = await getIGDBGameRefOrSnapshot({
        igdbId: result.id,
        name: countRow.name ?? result.name,
      })
      rows.push(serialiseGameListRow({ ...ref, clipCount: countRow.clipCount }))
      if (rows.length >= limit) break
    }

    return rows
  } catch (err) {
    logger.warn("IGDB game search failed:", err)
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
    .innerJoin(clip, eq(clip.igdbId, game.igdbId))
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
    .groupBy(game.igdbId)
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
    if (seen.has(row.igdbId)) continue
    seen.add(row.igdbId)
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
      WHEN ${user.displayUsername} ILIKE ${pattern}
        OR ${user.username} ILIKE ${pattern} THEN 1
      WHEN ${game.name} ILIKE ${pattern}
        OR ${clip.game} ILIKE ${pattern} THEN 2
      WHEN ${clip.description} ILIKE ${pattern} THEN 3
      ELSE 4
    END`

    const [clips, igdbGames, localGames, users] = await Promise.all([
      db
        .select(clipSelectShape)
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .leftJoin(game, eq(clip.igdbId, game.igdbId))
        .where(
          and(
            eq(clip.status, "ready"),
            publicClipPrivacyCondition(),
            isNull(user.disabledAt),
            or(
              ilike(clip.title, pattern),
              ilike(clip.description, pattern),
              ilike(user.displayUsername, pattern),
              ilike(user.username, pattern),
              ilike(game.name, pattern),
              ilike(clip.game, pattern),
            ),
          ),
        )
        .orderBy(matchRank, desc(clip.createdAt))
        .limit(limit),

      searchIGDBGames(q, limit),
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
            publicClipPrivacyCondition(),
          ),
        )
        .where(
          and(
            or(
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
      games: mergeGameResults(igdbGames, localGames, limit),
      users: users.map(serialiseUserListRow),
    })
  },
)
