import type { GameRow } from "@alloy/contracts"
import { clip, clipView, game, gameFollow } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { and, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm"

import { gameSelectShape, serialiseGameRow } from "./game-row"
import { exactNameKey, normalizedNameKey } from "./name-match"

export type IndexedGameNameLookupCandidate = {
  game: GameRow
  exact: boolean
  normalized: boolean
  score: number
  personalScore: number
  clipCount: number
}

export async function lookupIndexedGamesByName(
  names: string[],
  viewerId: string | null,
): Promise<Map<string, IndexedGameNameLookupCandidate[]>> {
  const queries = uniqueLookupQueries(names)
  const matches = new Map<string, IndexedGameNameLookupCandidate[]>()
  for (const name of queries) matches.set(exactNameKey(name), [])
  if (queries.length === 0) return matches

  const matchCondition = indexedGameMatchCondition(queries)
  if (!matchCondition) return matches

  const viewerClipCount = viewerId
    ? sql<number>`count(distinct case when ${clip.author_id} = ${viewerId}::uuid then ${clip.id} end)::int`
    : sql<number>`0`
  const viewerViewCount = viewerId
    ? sql<number>`count(distinct ${clipView.clip_id})::int`
    : sql<number>`0`
  const followed = viewerId
    ? sql<number>`max(case when ${gameFollow.id} is null then 0 else 1 end)::int`
    : sql<number>`0`

  const rows = await db
    .select({
      ...gameSelectShape,
      clipNames: sql<
        string[]
      >`coalesce(array_remove(array_agg(distinct ${clip.game}), null), ARRAY[]::text[])`,
      clipCount: sql<number>`count(distinct ${clip.id})::int`,
      viewerClipCount,
      viewerViewCount,
      followed,
    })
    .from(game)
    .leftJoin(clip, eq(clip.game_id, game.id))
    .leftJoin(
      clipView,
      and(
        eq(clipView.clip_id, clip.id),
        viewerId ? sql`${clipView.user_id} = ${viewerId}::uuid` : sql`false`,
      ),
    )
    .leftJoin(
      gameFollow,
      and(
        eq(gameFollow.game_id, game.id),
        viewerId ? sql`${gameFollow.user_id} = ${viewerId}::uuid` : sql`false`,
      ),
    )
    .where(matchCondition)
    .groupBy(game.id)

  for (const row of rows) {
    const gameRow = serialiseGameRow(row)
    const searchableNames = [gameRow.name, ...row.clipNames.filter(Boolean)]
    const personalScore =
      Number(row.followed) * 1_000 +
      Number(row.viewerClipCount) * 100 +
      Number(row.viewerViewCount) * 10
    const score = personalScore + Number(row.clipCount)

    for (const name of queries) {
      const exact = searchableNames.some(
        (candidate) => exactNameKey(candidate) === exactNameKey(name),
      )
      const normalized = searchableNames.some(
        (candidate) => normalizedNameKey(candidate) === normalizedNameKey(name),
      )
      if (!exact && !normalized) continue

      matches.get(exactNameKey(name))?.push({
        game: gameRow,
        exact,
        normalized,
        score,
        personalScore,
        clipCount: Number(row.clipCount),
      })
    }
  }

  for (const candidates of matches.values()) {
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.game.name.localeCompare(b.game.name)
    })
  }

  return matches
}

function uniqueLookupQueries(names: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (!trimmed) continue
    const key = exactNameKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function indexedGameMatchCondition(names: string[]): SQL | undefined {
  const exactKeys = names.map(exactNameKey)
  const conditions: SQL[] = [
    inArray(sql<string>`lower(${game.name})`, exactKeys),
    inArray(sql<string>`lower(${clip.game})`, exactKeys),
  ]

  for (const name of names) {
    const pattern = `%${name}%`
    conditions.push(ilike(game.name, pattern), ilike(clip.game, pattern))
  }

  return or(...conditions)
}
