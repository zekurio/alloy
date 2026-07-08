import { user } from "@alloy/db/auth-schema"
import { clip, clipLike, clipView, follow, game } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { clipSelectShape } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { gameSelectShape, serialiseGameRow } from "@alloy/server/games/ref"
import { badRequest, invalidCursor } from "@alloy/server/runtime/http-response"
import { and, eq, exists, ne, type SQL, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import {
  clipListCursorCondition,
  clipListOrderBy,
  clipListPage,
  parseClipListCursor,
  publicClipListingConditions,
} from "./clips-helpers"
import {
  listRecommendedClips,
  parseRecommendedClipCursor,
} from "./feed-recommendations"
import { limitQueryParam, zValidator } from "./validation"

const FilterEnum = z.enum(["all", "following", "game"])
const FeedSortEnum = z.enum(["top", "recent", "recommended"])

const FeedQuery = z
  .object({
    filter: FilterEnum.default("all"),
    sort: FeedSortEnum.default("recent"),
    gameId: z.uuid().optional(),
    authorId: z.uuid().optional(),
    limit: limitQueryParam(50, 20),
    cursor: z.string().optional(),
  })
  .refine((v) => v.filter !== "game" || v.gameId !== undefined, {
    message: "gameId is required when filter=game",
    path: ["gameId"],
  })

const ChipsQuery = z.object({
  limit: limitQueryParam(40, 20),
})

export const feedRoute = new Hono()
  .get("/", zValidator("query", FeedQuery), async (c) => {
    const {
      filter,
      sort,
      gameId,
      authorId,
      limit,
      cursor: rawCursor,
    } = c.req.valid("query")

    const session = await getSession(c)
    const viewerId = session?.user.id ?? null

    if (filter === "following" && !viewerId) {
      return c.json({ items: [], nextCursor: null })
    }

    const conditions: SQL[] = publicClipListingConditions()

    if (filter === "game") {
      if (!gameId) return badRequest(c, "gameId is required")
      conditions.push(eq(clip.game_id, gameId))
      if (authorId) conditions.push(eq(clip.author_id, authorId))
    }

    if (filter === "following") {
      // The following feed is strictly creator follows. Game follows power
      // recommendations instead, so starring a game doesn't muddy this tab.
      const followingViewerId = viewerId
      if (!followingViewerId) return c.json({ items: [], nextCursor: null })
      // Your own clips don't belong in a feed of people you follow.
      conditions.push(ne(clip.author_id, followingViewerId))
      conditions.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(follow)
            .where(
              and(
                eq(follow.follower_id, followingViewerId),
                eq(follow.following_id, clip.author_id),
              ),
            ),
        ),
      )
    }

    if (sort === "recommended") {
      const cursor = parseRecommendedClipCursor(rawCursor)
      if (rawCursor && !cursor) return invalidCursor(c)
      return c.json(
        await listRecommendedClips({ conditions, cursor, limit, viewerId }),
      )
    }

    const cursor = parseClipListCursor(rawCursor, sort)
    if (rawCursor && !cursor) return invalidCursor(c)

    const cursorCondition = clipListCursorCondition(cursor, sort)
    if (cursorCondition) conditions.push(cursorCondition)

    const rows = await db
      .select(clipSelectShape)
      .from(clip)
      .innerJoin(user, eq(clip.author_id, user.id))
      .leftJoin(game, eq(clip.game_id, game.id))
      .where(and(...conditions))
      .orderBy(...clipListOrderBy(sort))
      .limit(limit + 1)

    return c.json(clipListPage(rows, limit, sort))
  })
  .get("/chips", zValidator("query", ChipsQuery), async (c) => {
    const { limit } = c.req.valid("query")

    const session = await getSession(c)
    const viewerId = session?.user.id ?? null
    const vid = viewerId ?? null

    const likedCount = sql<number>`(count(distinct ${clipLike.clip_id}))::int`
    const viewedCount = sql<number>`(count(distinct ${clipView.clip_id}))::int`
    const clipCount = sql<number>`(count(distinct ${clip.id}))::int`
    const interaction = sql<number>`(
      (2 * (${likedCount}) + (${viewedCount}))::double precision
    )`
    // Chips mirror the "All" feed, which includes the viewer's own clips, so
    // a game you've only posted in yourself still gets a chip. `clipLike`/
    // `clipView` are still joined per-viewer to weight by your interaction.
    const conditions: SQL[] = publicClipListingConditions()

    const rows = await db
      .select({
        ...gameSelectShape,
        interaction,
        clipCount,
      })
      .from(clip)
      .innerJoin(user, eq(clip.author_id, user.id))
      .innerJoin(game, eq(clip.game_id, game.id))
      .leftJoin(
        clipLike,
        and(
          eq(clipLike.clip_id, clip.id),
          sql`${clipLike.user_id} = ${vid}::uuid`,
        ),
      )
      .leftJoin(
        clipView,
        and(
          eq(clipView.clip_id, clip.id),
          sql`${clipView.user_id} = ${vid}::uuid`,
        ),
      )
      .where(and(...conditions))
      .groupBy(game.id)
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
