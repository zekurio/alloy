import type { FeedPage } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, follow, game, gameFollow } from "@alloy/db/schema"
import { clipSelection, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { requiredSql } from "@alloy/server/db/sql"
import { dateFromDateLike, isoDate } from "@alloy/server/runtime/date"
import { and, eq, lt, or, type SQL, sql } from "drizzle-orm"

import {
  cursorDate,
  cursorFiniteNumber,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"

type RecommendedClipCursor = {
  score: number
  publishedAt: Date
  id: string
  asOf: Date
}

type RecommendedClipPageRow = Awaited<
  ReturnType<typeof selectRecommendedClipRows>
>[number]

export function parseRecommendedClipCursor(
  value: string | undefined,
): RecommendedClipCursor | null {
  if (!value) return null
  const parsed = decodeCursorPayload(value)
  if (!parsed) return null
  const score = cursorFiniteNumber(parsed.score)
  const publishedAt = cursorDate(parsed.publishedAt ?? parsed.createdAt)
  const id = cursorRequiredString(parsed.id)
  const asOf = cursorDate(parsed.asOf)
  if (score === null || !publishedAt || !id || !asOf) return null
  return {
    score,
    publishedAt,
    id,
    asOf,
  }
}

function encodeRecommendedClipCursor(cursor: RecommendedClipCursor): string {
  return encodeCursorPayload({
    score: cursor.score,
    publishedAt: isoDate(cursor.publishedAt),
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
    items: pageRows.map(({ rankScore: _rankScore, ...row }) => {
      const clipRow = toPublicClipRow(row)
      return {
        ...clipRow,
        createdAt: isoDate(clipRow.createdAt),
        publishedAt: clipRow.publishedAt ? isoDate(clipRow.publishedAt) : null,
        updatedAt: isoDate(clipRow.updatedAt),
      }
    }),
    nextCursor:
      rows.length > limit && tail
        ? encodeRecommendedClipCursor({
            score: tail.rankScore,
            publishedAt: dateFromDateLike(tail.publishedAt ?? tail.createdAt),
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
      (${clip.like_count} + 0.1 * ${clip.view_count})
      / power(
          extract(epoch from (${asOf}::timestamp - ${clip.published_at})) / 3600.0 + 2.0,
          1.5
        )
    )
    * (
        1.0
        + 1.0 * (
            CASE WHEN ${vid}::uuid IS NULL THEN 0
                 WHEN EXISTS (
                    SELECT 1 FROM ${follow}
                    WHERE ${follow.follower_id} = ${vid}::uuid
                      AND ${follow.following_id} = ${clip.author_id}
                 ) THEN 1 ELSE 0 END
          )
        + 0.5 * (
            CASE WHEN ${vid}::uuid IS NULL THEN 0
                 WHEN EXISTS (
                    SELECT 1 FROM ${gameFollow}
                    WHERE ${gameFollow.user_id} = ${vid}::uuid
                      AND ${gameFollow.game_id} = ${clip.game_id}
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
          lt(clip.published_at, cursor.publishedAt),
          and(
            eq(clip.published_at, cursor.publishedAt),
            sql`${clip.id} > ${cursor.id}`,
          ),
        ),
      ),
    ),
    "recommended feed cursor",
  )
}

async function selectRecommendedClipRows(
  pageConditions: SQL[],
  score: SQL<number>,
  limit: number,
) {
  return db
    .select({ ...clipSelection, rankScore: score })
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .leftJoin(game, eq(clip.game_id, game.id))
    .where(and(...pageConditions))
    .orderBy(sql`${score} desc`, sql`${clip.published_at} desc`, clip.id)
    .limit(limit + 1)
}

export async function listRecommendedClips({
  conditions,
  cursor,
  limit,
  viewerId,
}: {
  conditions: SQL[]
  cursor: RecommendedClipCursor | null
  limit: number
  viewerId: string | null
}): Promise<FeedPage> {
  const asOf = cursor?.asOf ?? new Date()
  const score = rankScore(viewerId, isoDate(asOf))
  const pageConditions = [...conditions]
  const cursorCondition = recommendedCursorCondition(cursor, score)
  if (cursorCondition) pageConditions.push(cursorCondition)

  const rows = await selectRecommendedClipRows(pageConditions, score, limit)

  return recommendedClipPage(rows, limit, asOf)
}
