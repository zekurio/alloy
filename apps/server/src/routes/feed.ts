import { zValidator } from "@hono/zod-validator"
import { and, eq, exists, ne, or, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { getAuth } from "../auth"
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
import { clipSelectShape } from "../lib/clip-select"

const FilterEnum = z.enum(["foryou", "following", "game"])

const FeedQuery = z
  .object({
    filter: FilterEnum.default("foryou"),
    gameId: z.uuid().optional(),
    limit: z.coerce.number().int().positive().max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((v) => v.filter !== "game" || v.gameId !== undefined, {
    message: "gameId is required when filter=game",
    path: ["gameId"],
  })

const ChipsQuery = z.object({
  limit: z.coerce.number().int().positive().max(40).default(20),
})

function rankScore(viewerId: string | null) {
  const vid = viewerId ?? null
  return sql<number>`
    (
      (${clip.likeCount} + 0.1 * ${clip.viewCount})
      / power(
          extract(epoch from (now() - ${clip.createdAt})) / 3600.0 + 2.0,
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
    const { filter, gameId, limit, offset } = c.req.valid("query")

    const session = await getAuth().api.getSession({
      headers: c.req.raw.headers,
    })
    const viewerId = session?.user.id ?? null

    if (filter === "following" && !viewerId) {
      // Nothing to personalise for anon — return an empty page rather
      // than leaking unrelated clips from the foryou corpus.
      return c.json([])
    }

    const conditions: SQL[] = [
      eq(clip.status, "ready"),
      // Feed is strictly public. Unlisted clips are reachable by link
      // but shouldn't surface via discovery.
      eq(clip.privacy, "public"),
    ]

    // Hide the viewer's own uploads — the feed is for discovering other
    // people's clips, not an author dashboard. Own-clip surfaces live
    // on /u/:username and the upload queue.
    if (viewerId) {
      conditions.push(ne(clip.authorId, viewerId))
    }

    if (filter === "game") {
      conditions.push(eq(clip.gameId, gameId!))
    }

    if (filter === "following") {
      // Either the clip author is followed, or the clip's game is
      // followed. Anon already returned above, so viewerId is set.
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

    const score = rankScore(viewerId)

    const rows = await db
      .select(clipSelectShape)
      .from(clip)
      .innerJoin(user, eq(clip.authorId, user.id))
      .leftJoin(game, eq(clip.gameId, game.id))
      .where(and(...conditions))
      // createdAt DESC and id ASC break ties deterministically so
      // neighbouring pages don't duplicate rows when scores collide.
      .orderBy(sql`${score} desc`, sql`${clip.createdAt} desc`, clip.id)
      .limit(limit)
      .offset(offset)

    return c.json(rows)
  })

  .get("/chips", zValidator("query", ChipsQuery), async (c) => {
    const { limit } = c.req.valid("query")

    const session = await getAuth().api.getSession({
      headers: c.req.raw.headers,
    })
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
