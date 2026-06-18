import { user } from "@alloy/db/auth-schema"
import {
  clip,
  clipLike,
  clipView,
  follow,
  game,
  gameFollow,
} from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { clipSelectShape } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { requiredSql } from "@alloy/server/db/sql"
import { gameSelectShape, serialiseGameRow } from "@alloy/server/games/ref"
import { badRequest, invalidCursor } from "@alloy/server/runtime/http-response"
import { and, eq, exists, isNull, ne, type SQL, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import {
  clipListCursorCondition,
  clipListOrderBy,
  clipListPage,
  parseClipListCursor,
} from "./clips-helpers"
import { limitQueryParam, zValidator } from "./validation"

const FilterEnum = z.enum(["all", "following", "recommended", "game"])

const FeedQuery = z
  .object({
    filter: FilterEnum.default("all"),
    sort: z.enum(["top", "recent"]).default("recent"),
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

export const feedRoute = new Hono()
  .get("/", zValidator("query", FeedQuery), async (c) => {
    const {
      filter,
      sort,
      steamgriddbId,
      limit,
      cursor: rawCursor,
    } = c.req.valid("query")
    const cursor = parseClipListCursor(rawCursor, sort)
    if (rawCursor && !cursor) return invalidCursor(c)

    const session = await getSession(c)
    const viewerId = session?.user.id ?? null

    if ((filter === "following" || filter === "recommended") && !viewerId) {
      // Nothing to personalise for anon — return an empty page rather
      // than leaking the whole public corpus.
      return c.json(clipListPage([], limit, sort))
    }

    const conditions: SQL[] = [
      eq(clip.status, "ready"),
      // Feed is strictly public. Unlisted clips are reachable by link
      // but shouldn't surface via discovery.
      eq(clip.privacy, "public"),
      isNull(user.disabledAt),
    ]

    if (filter === "game") {
      if (!steamgriddbId) return badRequest(c, "steamgriddbId is required")
      conditions.push(eq(clip.steamgriddbId, steamgriddbId))
    }

    if (filter === "following") {
      // The following feed is strictly creator follows. Game follows power
      // recommendations instead, so starring a game doesn't muddy this tab.
      const followingViewerId = viewerId
      if (!followingViewerId) return c.json(clipListPage([], limit, sort))
      // Your own clips don't belong in a feed of people you follow.
      conditions.push(ne(clip.authorId, followingViewerId))
      conditions.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(follow)
            .where(
              and(
                eq(follow.followerId, followingViewerId),
                eq(follow.followingId, clip.authorId),
              ),
            ),
        ),
      )
    }

    if (filter === "recommended") {
      // Initial recommendation signal: games the viewer starred.
      const recommendedViewerId = viewerId
      if (!recommendedViewerId) return c.json(clipListPage([], limit, sort))
      conditions.push(ne(clip.authorId, recommendedViewerId))
      conditions.push(
        requiredSql(
          exists(
            db
              .select({ one: sql`1` })
              .from(gameFollow)
              .where(
                and(
                  eq(gameFollow.userId, recommendedViewerId),
                  eq(gameFollow.steamgriddbId, clip.steamgriddbId),
                ),
              ),
          ),
          "recommended feed game filter",
        ),
      )
    }

    const cursorCondition = clipListCursorCondition(cursor, sort)
    if (cursorCondition) conditions.push(cursorCondition)

    const rows = await db
      .select(clipSelectShape)
      .from(clip)
      .innerJoin(user, eq(clip.authorId, user.id))
      .leftJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
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

    const likedCount = sql<number>`(count(distinct ${clipLike.clipId}))::int`
    const viewedCount = sql<number>`(count(distinct ${clipView.clipId}))::int`
    const clipCount = sql<number>`(count(distinct ${clip.id}))::int`
    const interaction = sql<number>`(
      (2 * (${likedCount}) + (${viewedCount}))::double precision
    )`
    // Chips mirror the "All" feed, which includes the viewer's own clips, so
    // a game you've only posted in yourself still gets a chip. `clipLike`/
    // `clipView` are still joined per-viewer to weight by your interaction.
    const conditions: SQL[] = [
      eq(clip.status, "ready"),
      eq(clip.privacy, "public"),
      isNull(user.disabledAt),
    ]

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
