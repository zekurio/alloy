import type { FeedPage } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipView, game } from "@alloy/db/schema"
import { clipSelection, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { requiredSql } from "@alloy/server/db/sql"
import { dateFromDateLike, isoDate } from "@alloy/server/runtime/date"
import { and, eq, lt, lte, or, type SQL, sql } from "drizzle-orm"

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
  conditions: SQL[],
  cursor: RecommendedClipCursor | null,
  limit: number,
  viewerId: string | null,
  asOf: Date,
) {
  // Qualified views are unique per viewer/clip. Read preferences through the
  // existing user/clip index, with no separate preference store to maintain.
  const watched = db.$with("viewer_history").as(
    db
      .select({ authorId: clip.author_id, gameId: clip.game_id })
      .from(clipView)
      .innerJoin(clip, eq(clipView.clip_id, clip.id))
      .innerJoin(user, eq(clip.author_id, user.id))
      .where(
        and(
          sql`${clipView.user_id} = ${viewerId}::uuid`,
          sql`${clip.author_id} <> ${viewerId}::uuid`,
          // View timestamps use database-local now(); let PostgreSQL apply
          // its time zone when comparing them to the UTC pagination anchor.
          sql`${clipView.created_at} <= ${isoDate(asOf)}::timestamptz`,
          ...publicClipListingConditions("video"),
        ),
      ),
  )
  const authorViews = db
    .select({
      authorId: watched.authorId,
      views: sql<number>`count(*)::int`.as("author_view_count"),
    })
    .from(watched)
    .groupBy(watched.authorId)
    .as("author_views")
  const gameViews = db
    .select({
      gameId: watched.gameId,
      views: sql<number>`count(*)::int`.as("game_view_count"),
    })
    .from(watched)
    .groupBy(watched.gameId)
    .as("game_views")
  const score = sql<number>`
    ((1.0 + ${clip.view_count})
    / power(extract(epoch from (${isoDate(asOf)}::timestamptz - ${clip.published_at})) / 3600.0 + 2.0, 1.5)
    * (1.0
       + least(2.0, ln(1.0 + coalesce(${authorViews.views}, 0)))
       + 0.5 * least(2.0, ln(1.0 + coalesce(${gameViews.views}, 0)))))::double precision
  `
  const pageConditions = [...conditions, lte(clip.published_at, asOf)]
  const cursorCondition = recommendedCursorCondition(cursor, score)
  if (cursorCondition) pageConditions.push(cursorCondition)

  return db
    .with(watched)
    .select({ ...clipSelection, rankScore: score })
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .leftJoin(game, eq(clip.game_id, game.id))
    .leftJoin(authorViews, eq(clip.author_id, authorViews.authorId))
    .leftJoin(gameViews, eq(clip.game_id, gameViews.gameId))
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
  const rows = await selectRecommendedClipRows(
    conditions,
    cursor,
    limit,
    viewerId,
    asOf,
  )
  return recommendedClipPage(rows, limit, asOf)
}
