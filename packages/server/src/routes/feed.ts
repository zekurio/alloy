import { user } from "alloy-db/auth-schema"
import {
  clip,
  clipLike,
  clipView,
  follow,
  game,
  gameFollow,
} from "alloy-db/schema"
import { and, eq, exists, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { getSession } from "../auth/session"
import { clipSelectShape, toPublicClipRow } from "../clips/select"
import { db } from "../db"
import { requiredSql } from "../db/sql"
import { gameSelectShape, serialiseGameRow } from "../games/ref"
import { dateFromDateLike, isoDate } from "../runtime/date"
import { badRequest, invalidCursor } from "../runtime/http-response"
import {
  cursorDate,
  cursorFiniteNumber,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import { limitQueryParam, zValidator } from "./validation"

const FilterEnum = z.enum(["foryou", "following", "game"])

const FeedQuery = z
  .object({
    filter: FilterEnum.default("foryou"),
    steamgriddbId: z.coerce.number().int().positive().optional(),
    limit: limitQueryParam(50, 20),
    cursor: z.string().optional(),
  })
  .refine((v) => v.filter !== "game" || v.steamgriddbId !== undefined, {
    message: "steamgriddbId is required when filter=game",
    path: ["steamgriddbId"],
  })

const ChipsQuery = z.object({
  limit: limitQueryParam(40, 20),
})

type FeedCursor = {
  score: number
  createdAt: Date
  id: string
  asOf: Date
}

type FeedPageRow = {
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
  steamgriddbId: number
  game: string | null
}

function parseFeedCursor(value: string | undefined): FeedCursor | null {
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

function encodeFeedCursor(cursor: FeedCursor): string {
  return encodeCursorPayload({
    score: cursor.score,
    createdAt: isoDate(cursor.createdAt),
    id: cursor.id,
    asOf: isoDate(cursor.asOf),
  })
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

function feedPage<T extends FeedPageRow>(rows: T[], limit: number, asOf: Date) {
  const pageRows = rows.slice(0, limit)
  const tail = pageRows[pageRows.length - 1]
  return {
    items: pageRows.map(({ rankScore: _rankScore, ...row }) =>
      toPublicClipRow(row),
    ),
    nextCursor:
      rows.length > limit && tail
        ? encodeFeedCursor({
            score: tail.rankScore,
            createdAt: dateFromDateLike(tail.createdAt),
            id: tail.id,
            asOf,
          })
        : null,
  }
}

export const feedRoute = new Hono()
  .get("/", zValidator("query", FeedQuery), async (c) => {
    const {
      filter,
      steamgriddbId,
      limit,
      cursor: rawCursor,
    } = c.req.valid("query")
    const cursor = parseFeedCursor(rawCursor)
    if (rawCursor && !cursor) return invalidCursor(c)
    const asOf = cursor?.asOf ?? new Date()

    const session = await getSession(c)
    const viewerId = session?.user.id ?? null

    if (filter === "following" && !viewerId) {
      // Nothing to personalise for anon — return an empty page rather
      // than leaking unrelated clips from the foryou corpus.
      return c.json(feedPage([], limit, asOf))
    }

    const conditions: SQL[] = [
      eq(clip.status, "ready"),
      // Feed is strictly public. Unlisted clips are reachable by link
      // but shouldn't surface via discovery.
      eq(clip.privacy, "public"),
      isNull(user.disabledAt),
    ]

    if (viewerId) {
      conditions.push(ne(clip.authorId, viewerId))
    }

    if (filter === "game") {
      if (!steamgriddbId) return badRequest(c, "steamgriddbId is required")
      conditions.push(eq(clip.steamgriddbId, steamgriddbId))
    }

    if (filter === "following") {
      // Either the clip author is followed, or the clip's game is
      // favourited. Anon already returned above, so viewerId is set.
      const followingViewerId = viewerId
      if (!followingViewerId) return c.json(feedPage([], limit, asOf))
      const userFollowed = exists(
        db
          .select({ one: sql`1` })
          .from(follow)
          .where(
            and(
              eq(follow.followerId, followingViewerId),
              eq(follow.followingId, clip.authorId),
            ),
          ),
      )
      const gameFollowed = requiredSql(
        and(
          exists(
            db
              .select({ one: sql`1` })
              .from(gameFollow)
              .where(
                and(
                  eq(gameFollow.userId, followingViewerId),
                  eq(gameFollow.steamgriddbId, clip.steamgriddbId),
                ),
              ),
          ),
        ),
        "following feed game filter",
      )
      conditions.push(
        requiredSql(or(userFollowed, gameFollowed), "following feed filter"),
      )
    }

    const score = rankScore(viewerId, isoDate(asOf))
    if (cursor) {
      conditions.push(
        requiredSql(
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
          "feed cursor",
        ),
      )
    }

    const rows = await db
      .select({ ...clipSelectShape, rankScore: score })
      .from(clip)
      .innerJoin(user, eq(clip.authorId, user.id))
      .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
      .where(and(...conditions))
      // createdAt DESC and id ASC break ties deterministically so
      // neighbouring pages don't duplicate rows when scores collide.
      .orderBy(sql`${score} desc`, sql`${clip.createdAt} desc`, clip.id)
      .limit(limit + 1)

    return c.json(feedPage(rows, limit, asOf))
  })
  .get("/chips", zValidator("query", ChipsQuery), async (c) => {
    const { limit } = c.req.valid("query")

    const session = await getSession(c)
    const viewerId = session?.user.id ?? null
    const vid = viewerId ?? null

    const likedCount = sql<number>`(count(distinct ${clipLike.clipId}))::int`
    const viewedCount = sql<number>`(count(distinct ${clipView.clipId}))::int`
    const clipCount = sql<number>`(count(distinct ${clip.id}))::int`
    const interaction = sql<number>`(
      (2 * (${likedCount}) + (${viewedCount}))::double precision
    )`
    const conditions: SQL[] = [
      eq(clip.status, "ready"),
      eq(clip.privacy, "public"),
      isNull(user.disabledAt),
    ]
    if (viewerId) {
      conditions.push(ne(clip.authorId, viewerId))
    }

    const rows = await db
      .select({
        ...gameSelectShape,
        interaction,
        clipCount,
      })
      .from(clip)
      .innerJoin(user, eq(clip.authorId, user.id))
      .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
      .leftJoin(
        clipLike,
        and(
          eq(clipLike.clipId, clip.id),
          sql`${clipLike.userId} = ${vid}::uuid`,
        ),
      )
      .leftJoin(
        clipView,
        and(
          eq(clipView.clipId, clip.id),
          sql`${clipView.userId} = ${vid}::uuid`,
        ),
      )
      .where(and(...conditions))
      .groupBy(game.steamgriddbId)
      .orderBy(sql`${interaction} desc`, sql`${clipCount} desc`, game.name)
      .limit(limit)

    const games = rows.map((row) => {
      const ref = serialiseGameRow(row)
      return {
        id: ref.id,
        steamgriddbId: ref.steamgriddbId,
        slug: ref.slug,
        name: ref.name,
        iconUrl: ref.iconUrl,
        logoUrl: ref.logoUrl,
        interaction: row.interaction,
        clipCount: row.clipCount,
      }
    })

    return c.json({
      games,
    })
  })
