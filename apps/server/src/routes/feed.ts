import { limitQueryParam, zValidator } from "./validation"
import { and, eq, exists, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { user } from "@workspace/db/auth-schema"
import {
  clip,
  clipLike,
  clipView,
  follow,
  game,
  gameFollow,
} from "@workspace/db/schema"

import { db } from "../db"
import { requiredSql } from "../db/sql"
import { getSession } from "../auth/session"
import { clipSelectShape, toPublicClipRow } from "../clips/select"
import { dateFromDateLike, isoDate } from "../runtime/date"
import { badRequest, invalidCursor } from "../runtime/http-response"
import {
  cursorDate,
  cursorFiniteNumber,
  cursorRequiredString,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import { hashtagTextFilter } from "./hashtag-filter"

const FilterEnum = z.enum(["foryou", "following", "game", "hashtag"])

const FeedQuery = z
  .object({
    filter: FilterEnum.default("foryou"),
    gameId: z.uuid().optional(),
    tag: z
      .string()
      .regex(/^[\p{L}\p{N}_]+$/u)
      .optional(),
    limit: limitQueryParam(50, 20),
    cursor: z.string().optional(),
  })
  .refine((v) => v.filter !== "game" || v.gameId !== undefined, {
    message: "gameId is required when filter=game",
    path: ["gameId"],
  })
  .refine((v) => v.filter !== "hashtag" || v.tag !== undefined, {
    message: "tag is required when filter=hashtag",
    path: ["tag"],
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
  openGraphKey: string | null
  thumbKey: string | null
  variants: readonly { storageKey: string }[]
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
            CASE WHEN ${vid}::uuid IS NULL OR ${clip.gameId} IS NULL THEN 0
                 WHEN EXISTS (
                    SELECT 1 FROM ${gameFollow}
                    WHERE ${gameFollow.userId} = ${vid}::uuid
                      AND ${gameFollow.gameId} = ${clip.gameId}
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
      toPublicClipRow(row)
    ),
    nextCursor: rows.length > limit && tail
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
      gameId,
      tag,
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
      if (!gameId) return badRequest(c, "gameId is required")
      conditions.push(eq(clip.gameId, gameId))
    }

    if (filter === "hashtag") {
      if (!tag) return badRequest(c, "tag is required")
      conditions.push(hashtagTextFilter(tag))
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
          sql`${clip.gameId} IS NOT NULL`,
          exists(
            db
              .select({ one: sql`1` })
              .from(gameFollow)
              .where(
                and(
                  eq(gameFollow.userId, followingViewerId),
                  eq(gameFollow.gameId, clip.gameId),
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
      .leftJoin(game, eq(clip.gameId, game.id))
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

    // Subquery: is there currently a visible clip in this game? Gates
    // the outer select so empty games don't pollute the chip bar.
    const hasVisibleClip = sql`
      EXISTS (
        SELECT 1 FROM ${clip}
        WHERE ${clip.gameId} = ${game.id}
          AND ${clip.status} = 'ready'
          AND ${clip.privacy} = 'public'
          AND EXISTS (
            SELECT 1 FROM ${user}
            WHERE ${user.id} = ${clip.authorId}
              AND ${user.disabledAt} IS NULL
          )
      )
    `

    const selfCount = sql<number>`(
      SELECT count(*)::int FROM ${clip}
      WHERE ${clip.gameId} = ${game.id}
        AND ${clip.authorId} = ${vid}::uuid
        AND ${clip.status} = 'ready'
    )`
    const likedCount = sql<number>`(
      SELECT count(*)::int FROM ${clipLike} cl
      JOIN ${clip} c ON c.id = cl.clip_id
      WHERE cl.user_id = ${vid}::uuid
        AND c.game_id = ${game.id}
        AND c.status = 'ready'
    )`
    const viewedCount = sql<number>`(
      SELECT count(*)::int FROM ${clipView} cv
      JOIN ${clip} c ON c.id = cv.clip_id
      WHERE cv.user_id = ${vid}::uuid
        AND c.game_id = ${game.id}
        AND c.status = 'ready'
    )`
    const clipCount = sql<number>`(
      SELECT count(*)::int FROM ${clip}
      WHERE ${clip.gameId} = ${game.id}
        AND ${clip.status} = 'ready'
        AND ${clip.privacy} IN ('public', 'unlisted')
        AND EXISTS (
          SELECT 1 FROM ${user}
          WHERE ${user.id} = ${clip.authorId}
            AND ${user.disabledAt} IS NULL
        )
    )`
    const interaction = sql<number>`(
      3 * ${selfCount} + 2 * ${likedCount} + 1 * ${viewedCount}
    )`

    const rows = await db
      .select({
        id: game.id,
        slug: game.slug,
        name: game.name,
        iconUrl: game.iconUrl,
        logoUrl: game.logoUrl,
        interaction,
        clipCount,
      })
      .from(game)
      .where(hasVisibleClip)
      .orderBy(sql`${interaction} desc`, sql`${clipCount} desc`, game.name)
      .limit(limit)

    return c.json({
      games: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        iconUrl: row.iconUrl,
        logoUrl: row.logoUrl,
        interaction: row.interaction,
        clipCount: row.clipCount,
      })),
    })
  })
