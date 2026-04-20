import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { clip, game, user } from "@workspace/db/schema"

import { db } from "../db"
import { clipSelectShape } from "../lib/clip-select"

/**
 * Global search surface. Backs the header search dropdown on the web
 * client — fans a single query string out to clips, games, and users so
 * the UI can render one mixed results list without making three round
 * trips per keystroke.
 *
 * The match is case-insensitive substring (`ILIKE %q%`) across a few
 * columns per entity. Nothing fancy (no FTS, no trigram) — the data
 * set this runs against is small enough that a seq scan is cheap, and
 * we avoid an index/extension dependency.
 *
 * Privacy + readiness filters mirror the public feed: only
 * `status='ready'` clips with `privacy in (public,unlisted)` show up,
 * and only games that still have at least one visible clip appear in
 * the games list. Banned users are hidden. So a query for a private
 * title or suspended creator never leaks through the dropdown.
 */

const SearchQuery = z.object({
  q: z.string().min(1).max(120),
  // Caps per-bucket so a long query doesn't burst the JSON payload. The
  // UI only paints 6-ish rows per group; 8 leaves a little slack for
  // future UX tweaks without letting a client request hundreds.
  limit: z.coerce.number().int().positive().max(20).default(8),
})

/**
 * Turn a user-entered query into a safe ILIKE pattern. Escapes the
 * three special chars (`\`, `%`, `_`) so a literal `%` in the input
 * doesn't silently widen the match into "everything". `%q%` is the
 * substring-anywhere semantics the UI expects.
 */
function toLikePattern(raw: string): string {
  const escaped = raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
  return `%${escaped}%`
}

export const searchRoute = new Hono()
  /**
   * GET /api/search?q=&limit= — returns `{ clips, games, users }`. Each
   * array follows the same shape the feed/list endpoints already hand
   * back so the client can reuse its existing row types without branching.
   *
   * Runs the three reads in parallel — they don't depend on each other,
   * and the connection pool is more than wide enough for a few extra
   * concurrent queries per search keystroke.
   */
  .get("/", zValidator("query", SearchQuery), async (c) => {
    const { q, limit } = c.req.valid("query")
    const pattern = toLikePattern(q.trim())

    // Rank clips by how "directly" the query matched. A clip whose title
    // literally contains the query outranks one that only matched because
    // its *game* has the query in its name — otherwise a search for
    // "valorant" floods the Clips section with every Valorant highlight
    // before the actual Valorant game row gets a look-in. Lower number =
    // higher rank; ties broken by recency via `desc(createdAt)`.
    const matchRank = sql<number>`CASE
      WHEN ${clip.title} ILIKE ${pattern} THEN 0
      WHEN ${user.username} ILIKE ${pattern} THEN 1
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

      // Users: match username; exclude banned accounts. We don't gate on
      // "has visible clips" — a freshly-signed-up creator still matters
      // for follow discovery, and the profile page handles the empty-
      // clip state cleanly. `banned` is a nullable bool; treat null as
      // "not banned". We left-join clips to attach a visible clip count
      // for the row subtitle (same privacy filter as everywhere else).
      db
        .select({
          id: user.id,
          username: user.username,
          image: user.image,
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
            ilike(user.username, pattern),
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
        clipCount: row.clipCount,
      })),
      users: users.map((row) => ({
        id: row.id,
        username: row.username,
        image: row.image,
        createdAt: row.createdAt.toISOString(),
        clipCount: row.clipCount,
      })),
    })
  })
