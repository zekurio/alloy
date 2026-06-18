import type { FeedPage } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, follow, game, gameFollow } from "@alloy/db/schema"
import { clipSelectShape, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { requiredSql } from "@alloy/server/db/sql"
import { dateFromDateLike, isoDate } from "@alloy/server/runtime/date"
import { and, eq, lt, ne, or, type SQL, sql } from "drizzle-orm"

import { publicClipListingConditions } from "./clips-helpers"
import {
  cursorDate,
  cursorFiniteNumber,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"

type RecommendedClipCursor = {
  score: number
  createdAt: Date
  id: string
  asOf: Date
}

type RecommendedClipPageRow = {
  id: string
  createdAt: Date | string
  rankScore: number
  sourceKey: string | null
  sourceContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  sourceSizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  thumbKey: string | null
  thumbBlurHash: string | null
  steamgriddbId: number | null
  game: string | null
}

export function parseRecommendedClipCursor(
  value: string | undefined,
): RecommendedClipCursor | null {
  if (!value) return null
  const parsed = decodeCursorPayload(value)
  if (!parsed) return null
  const score = cursorFiniteNumber(parsed.score)
  const createdAt = cursorDate(parsed.createdAt)
  const id = cursorRequiredString(parsed.id)
  const asOf = cursorDate(parsed.asOf)
  if (score === null || !createdAt || !id || !asOf) return null
  return {
    score,
    createdAt,
    id,
    asOf,
  }
}

function encodeRecommendedClipCursor(cursor: RecommendedClipCursor): string {
  return encodeCursorPayload({
    score: cursor.score,
    createdAt: isoDate(cursor.createdAt),
    id: cursor.id,
    asOf: isoDate(cursor.asOf),
  })
}

function recommendedClipPage(
  rows: RecommendedClipPageRow[],
  limit: number,
  asOf: Date,
): FeedPage {
  const pageRows = rows.slice(0, limit)
  const tail = pageRows[pageRows.length - 1]
  return {
    items: pageRows.map(({ rankScore: _rankScore, ...row }) =>
      toPublicClipRow(row),
    ) as FeedPage["items"],
    nextCursor:
      rows.length > limit && tail
        ? encodeRecommendedClipCursor({
            score: tail.rankScore,
            createdAt: dateFromDateLike(tail.createdAt),
            id: tail.id,
            asOf,
          })
        : null,
  }
}

function rankScore(viewerId: string | null, asOf: string) {
  const vid = viewerId ?? null
  return sql<number>`
    (
      (${clip.likeCount} + 0.1 * ${clip.viewCount})
      / power(
          extract(epoch from (${asOf}::timestamp - ${clip.createdAt})) / 3600.0 + 2.0,
          1.5
        )
    )
    * (
        1.0
        + 1.0 * (
            CASE WHEN ${vid}::uuid IS NULL THEN 0
                 WHEN EXISTS (
                    SELECT 1 FROM ${follow}
                    WHERE ${follow.followerId} = ${vid}::uuid
                      AND ${follow.followingId} = ${clip.authorId}
                 ) THEN 1 ELSE 0 END
          )
        + 0.5 * (
            CASE WHEN ${vid}::uuid IS NULL THEN 0
                 WHEN EXISTS (
                    SELECT 1 FROM ${gameFollow}
                    WHERE ${gameFollow.userId} = ${vid}::uuid
                      AND ${gameFollow.steamgriddbId} = ${clip.steamgriddbId}
                 ) THEN 1 ELSE 0 END
          )
      )
  `
}

function recommendedCursorCondition(
  cursor: RecommendedClipCursor | null,
  score: SQL<number>,
): SQL | null {
  if (!cursor) return null

  return requiredSql(
    or(
      lt(score, cursor.score),
      and(
        sql`abs(${score} - ${cursor.score}) < 0.000000000001`,
        or(
          lt(clip.createdAt, cursor.createdAt),
          and(
            eq(clip.createdAt, cursor.createdAt),
            sql`${clip.id} > ${cursor.id}`,
          ),
        ),
      ),
    ),
    "recommended feed cursor",
  )
}

export async function listRecommendedClips({
  cursor,
  limit,
  viewerId,
}: {
  cursor: RecommendedClipCursor | null
  limit: number
  viewerId: string | null
}): Promise<FeedPage> {
  const asOf = cursor?.asOf ?? new Date()
  const score = rankScore(viewerId, isoDate(asOf))
  const conditions: SQL[] = publicClipListingConditions()
  if (viewerId) conditions.push(ne(clip.authorId, viewerId))
  const cursorCondition = recommendedCursorCondition(cursor, score)
  if (cursorCondition) conditions.push(cursorCondition)

  const rows = await db
    .select({ ...clipSelectShape, rankScore: score })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .leftJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
    .where(and(...conditions))
    .orderBy(sql`${score} desc`, sql`${clip.createdAt} desc`, clip.id)
    .limit(limit + 1)

  return recommendedClipPage(rows, limit, asOf)
}
