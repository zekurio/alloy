import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { user } from "@workspace/db/auth-schema"
import { clip, game } from "@workspace/db/schema"

import { db } from "../db"
import { clipSelectShape } from "../lib/clip-select"

const SearchQuery = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().positive().max(20).default(8),
})

function toLikePattern(raw: string): string {
  const escaped = raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
  return `%${escaped}%`
}

export const searchRoute = new Hono()
  .get("/", zValidator("query", SearchQuery), async (c) => {
    const { q, limit } = c.req.valid("query")
    const pattern = toLikePattern(q.trim())

    const matchRank = sql<number>`CASE
      WHEN ${clip.title} ILIKE ${pattern} THEN 0
      WHEN ${user.name} ILIKE ${pattern}
        OR ${user.displayUsername} ILIKE ${pattern}
        OR ${user.username} ILIKE ${pattern} THEN 1
      WHEN ${clip.description} ILIKE ${pattern} THEN 2
      ELSE 3
    END`

    const [clips, games, users] = await Promise.all([
      // Clips: match title/description/authorUsername/gameRef.name.
      // `ready` + non-private filter mirrors the public feed exactly so
      // the search surface never leaks a clip the feed wouldn't show.
      db
        .select(clipSelectShape)
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .leftJoin(game, eq(clip.gameId, game.id))
        .where(
          and(
            eq(clip.status, "ready"),
            inArray(clip.privacy, ["public", "unlisted"]),
            or(
              ilike(clip.title, pattern),
              ilike(clip.description, pattern),
              ilike(user.name, pattern),
              ilike(user.displayUsername, pattern),
              ilike(user.username, pattern),
              ilike(game.name, pattern),
              ilike(clip.game, pattern)
            )
          )
        )
        .orderBy(matchRank, desc(clip.createdAt))
        .limit(limit),

      // Games: match name/slug. Filtered to rows with at least one
      // visible ready clip so an "abandoned" resolved-but-empty row
      // doesn't clutter the dropdown — same rule the /api/games grid
      // uses, just with the text filter layered on top.
      db
        .select({
          id: game.id,
          steamgriddbId: game.steamgriddbId,
          name: game.name,
          slug: game.slug,
          releaseDate: game.releaseDate,
          heroUrl: game.heroUrl,
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
            inArray(clip.privacy, ["public", "unlisted"])
          )
        )
        .where(or(ilike(game.name, pattern), ilike(game.slug, pattern)))
        .groupBy(game.id)
        .orderBy(sql`count(${clip.id}) desc`, game.name)
        .limit(limit),

      db
        .select({
          id: user.id,
          username: user.username,
          displayUsername: user.displayUsername,
          name: user.name,
          image: user.image,
          imageKey: user.imageKey,
          createdAt: user.createdAt,
          clipCount: sql<number>`count(${clip.id})::int`,
        })
        .from(user)
        .leftJoin(
          clip,
          and(
            eq(clip.authorId, user.id),
            eq(clip.status, "ready"),
            inArray(clip.privacy, ["public", "unlisted"])
          )
        )
        .where(
          and(
            or(
              ilike(user.name, pattern),
              ilike(user.displayUsername, pattern),
              ilike(user.username, pattern)
            ),
            or(isNull(user.banned), eq(user.banned, false))
          )
        )
        .groupBy(user.id)
        // Users with visible clips rank above empty accounts, then
        // alphabetical within each band so results are stable across
        // refetches.
        .orderBy(sql`count(${clip.id}) desc`, user.username)
        .limit(limit),
    ])

    return c.json({
      clips,
      games: games.map((row) => ({
        id: row.id,
        steamgriddbId: row.steamgriddbId,
        name: row.name,
        slug: row.slug,
        releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
        heroUrl: row.heroUrl,
        logoUrl: row.logoUrl,
        iconUrl: row.iconUrl,
        clipCount: row.clipCount,
      })),
      users: users.map((row) => ({
        id: row.id,
        username: row.username,
        displayUsername: row.displayUsername,
        name: row.name,
        image: row.image,
        imageKey: row.imageKey,
        createdAt: row.createdAt.toISOString(),
        clipCount: row.clipCount,
      })),
    })
  })
