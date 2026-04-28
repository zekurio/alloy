import { Buffer } from "node:buffer"

import { zValidator } from "@hono/zod-validator"
import { and, eq, exists, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm"
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
import { getSession } from "../auth/session"
import { clipSelectShape } from "../clips/select"

const FilterEnum = z.enum(["foryou", "following", "game"])

const FeedQuery = z
  .object({
    filter: FilterEnum.default("foryou"),
    gameId: z.uuid().optional(),
    limit: z.coerce.number().int().positive().max(50).default(20),
    cursor: z.string().optional(),
  })
  .refine((v) => v.filter !== "game" || v.gameId !== undefined, {
    message: "gameId is required when filter=game",
    path: ["gameId"],
  })

const ChipsQuery = z.object({
  limit: z.coerce.number().int().positive().max(40).default(20),
})

type FeedCursor = {
  score: number
  createdAt: string
  id: string
  asOf: string
}

function parseFeedCursor(value: string | undefined): FeedCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<FeedCursor>
    if (
      typeof parsed.score !== "number" ||
      !Number.isFinite(parsed.score) ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      typeof parsed.asOf !== "string"
    ) {
      return null
    }
    return {
      score: parsed.score,
      createdAt: parsed.createdAt,
      id: parsed.id,
      asOf: parsed.asOf,
    }
  } catch {
    return null
  }
}

function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
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

export const feedRoute = new Hono()
  .get("/", zValidator("query", FeedQuery), async (c) => {
    const { filter, gameId, limit, cursor: rawCursor } = c.req.valid("query")
    const cursor = parseFeedCursor(rawCursor)
    const asOf = cursor ? new Date(cursor.asOf) : new Date()
    if (Number.isNaN(asOf.getTime())) {
      return c.json({ error: "Invalid cursor" }, 400)
    }

    const session = await getSession(c)
    const viewerId = session?.user.id ?? null

    if (filter === "following" && !viewerId) {
      // Nothing to personalise for anon — return an empty page rather
      // than leaking unrelated clips from the foryou corpus.
      return c.json({ items: [], nextCursor: null })
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
      conditions.push(eq(clip.gameId, gameId!))
    }

    if (filter === "following") {
      // Either the clip author is followed, or the clip's game is
      // favourited. Anon already returned above, so viewerId is set.
      const userFollowed = exists(
        db
          .select({ one: sql`1` })
          .from(follow)
          .where(
            and(
              eq(follow.followerId, viewerId!),
              eq(follow.followingId, clip.authorId)
            )
          )
      )
      const gameFollowed = and(
        sql`${clip.gameId} IS NOT NULL`,
        exists(
          db
            .select({ one: sql`1` })
            .from(gameFollow)
            .where(
              and(
                eq(gameFollow.userId, viewerId!),
                eq(gameFollow.gameId, clip.gameId)
              )
            )
        )
      )!
      const combined = or(userFollowed, gameFollowed)
      if (combined) conditions.push(combined)
    }

    const score = rankScore(viewerId, asOf.toISOString())
    if (rawCursor && !cursor) {
      return c.json({ error: "Invalid cursor" }, 400)
    }
    if (cursor) {
      const cursorCreatedAt = new Date(cursor.createdAt)
      if (Number.isNaN(cursorCreatedAt.getTime())) {
        return c.json({ error: "Invalid cursor" }, 400)
      }
      conditions.push(
        or(
          lt(score, cursor.score),
          and(
            sql`abs(${score} - ${cursor.score}) < 0.000000000001`,
            or(
              lt(clip.createdAt, cursorCreatedAt),
              and(
                eq(clip.createdAt, cursorCreatedAt),
                sql`${clip.id} > ${cursor.id}`
              )
            )
          )
        )!
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
      .limit(limit)

    const tail = rows[rows.length - 1]
    const nextCursor =
      rows.length === limit && tail
        ? encodeFeedCursor({
            score: tail.rankScore,
            createdAt:
              tail.createdAt instanceof Date
                ? tail.createdAt.toISOString()
                : String(tail.createdAt),
            id: tail.id,
            asOf: asOf.toISOString(),
          })
        : null

    return c.json({
      items: rows.map(({ rankScore: _rankScore, ...row }) => row),
      nextCursor,
    })
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
