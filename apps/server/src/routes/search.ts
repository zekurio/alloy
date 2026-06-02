import {
  limitQueryParam,
  requiredTrimmedString,
  zValidator,
} from "./validation"
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { user } from "@workspace/db/auth-schema"
import { clip, game } from "@workspace/db/schema"

import { db } from "../db"
import { clipSelectShape, toPublicClipRow } from "../clips/select"
import { serialiseGameListRow } from "./games-helpers"
import {
  serialiseUserListRow,
  toLikePattern,
  userSummarySelectShape,
} from "./users-helpers"

const SearchQuery = z.object({
  q: requiredTrimmedString(120),
  limit: limitQueryParam(20, 8),
})

export const searchRoute = new Hono().get(
  "/",
  zValidator("query", SearchQuery),
  async (c) => {
    const { q, limit } = c.req.valid("query")
    const pattern = toLikePattern(q)

    const matchRank = sql<number>`CASE
      WHEN ${clip.title} ILIKE ${pattern} THEN 0
      WHEN ${user.name} ILIKE ${pattern}
        OR ${user.displayUsername} ILIKE ${pattern}
        OR ${user.username} ILIKE ${pattern} THEN 1
      WHEN ${clip.description} ILIKE ${pattern} THEN 2
      ELSE 3
    END`

    const [clips, games, users] = await Promise.all([
      db
        .select(clipSelectShape)
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .leftJoin(game, eq(clip.gameId, game.id))
        .where(
          and(
            eq(clip.status, "ready"),
            inArray(clip.privacy, ["public", "unlisted"]),
            isNull(user.disabledAt),
            or(
              ilike(clip.title, pattern),
              ilike(clip.description, pattern),
              ilike(user.name, pattern),
              ilike(user.displayUsername, pattern),
              ilike(user.username, pattern),
              ilike(game.name, pattern),
              ilike(clip.game, pattern),
            ),
          ),
        )
        .orderBy(matchRank, desc(clip.createdAt))
        .limit(limit),

      db
        .select({
          id: game.id,
          steamgriddbId: game.steamgriddbId,
          name: game.name,
          slug: game.slug,
          releaseDate: game.releaseDate,
          heroUrl: game.heroUrl,
          gridUrl: game.gridUrl,
          logoUrl: game.logoUrl,
          iconUrl: game.iconUrl,
          clipCount: sql<number>`count(${clip.id})::int`,
        })
        .from(game)
        .innerJoin(
          clip,
          and(
            eq(clip.gameId, game.id),
            eq(clip.status, "ready"),
            inArray(clip.privacy, ["public", "unlisted"]),
          ),
        )
        .innerJoin(user, eq(clip.authorId, user.id))
        .where(
          and(
            or(ilike(game.name, pattern), ilike(game.slug, pattern)),
            isNull(user.disabledAt),
          ),
        )
        .groupBy(game.id)
        .orderBy(sql`count(${clip.id}) desc`, game.name)
        .limit(limit),

      db
        .select({
          ...userSummarySelectShape,
          createdAt: user.createdAt,
          clipCount: sql<number>`count(${clip.id})::int`,
        })
        .from(user)
        .leftJoin(
          clip,
          and(
            eq(clip.authorId, user.id),
            eq(clip.status, "ready"),
            inArray(clip.privacy, ["public", "unlisted"]),
          ),
        )
        .where(
          and(
            or(
              ilike(user.name, pattern),
              ilike(user.displayUsername, pattern),
              ilike(user.username, pattern),
            ),
            isNull(user.disabledAt),
          ),
        )
        .groupBy(user.id)
        .orderBy(sql`count(${clip.id}) desc`, user.username)
        .limit(limit),
    ])

    return c.json({
      clips: clips.map(toPublicClipRow),
      games: games.map(serialiseGameListRow),
      users: users.map(serialiseUserListRow),
    })
  },
)
