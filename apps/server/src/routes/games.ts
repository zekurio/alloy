import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { clip, game, user } from "@workspace/db/schema"

import { db } from "../db"
import { clipSelectShape } from "../lib/clip-select"
import { generateUniqueGameSlug } from "../lib/game-slug"
import { requireSession } from "../lib/require-session"
import {
  SteamGridDBError,
  SteamGridDBNotConfiguredError,
  getGameAssets,
  getGameById,
  isConfigured,
  searchGames,
} from "../lib/steamgriddb"

/**
 * Games read + write surface.
 *
 * Two classes of endpoint:
 *   - SGDB-backed (`/search`, `/resolve`) — requires the admin to have
 *     configured a SteamGridDB API key. Returns 503 when unconfigured
 *     so the upload UI can fall back to a disabled picker.
 *   - DB-backed (`/`, `/:slug`, `/:slug/clips`, `/:slug/top-clips`) —
 *     read-only, uses only our own `game` + `clip` tables. Works even
 *     when SGDB is down or unconfigured, because we cache
 *     name/hero/logo into the row at resolve time.
 *
 * Resolve is where the coupling happens: on upload the client picks
 * an SGDB id from the autocomplete, then hits `/resolve` to upsert a
 * row (fetching hero+logo inline). Subsequent clips for the same
 * game skip the SGDB round trip entirely — the `steamgriddb_id`
 * unique index short-circuits back to the existing row.
 */

// ─── Validation ────────────────────────────────────────────────────────

const SlugParam = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    // Same shape produced by `slugifyGame()` — lowercase letters,
    // digits, hyphens. Rejecting everything else up-front saves a DB
    // roundtrip on bots probing `/g/../../admin` style URLs.
    .regex(/^[a-z0-9-]+$/),
})

const SearchQuery = z.object({
  q: z.string().min(1).max(120),
})

const ResolveBody = z.object({
  steamgriddbId: z.number().int().positive(),
})

const ClipsQuery = z.object({
  sort: z.enum(["top", "recent"]).default("recent"),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.iso.datetime().optional(),
})

const TopQuery = z.object({
  limit: z.coerce.number().int().positive().max(20).default(5),
})

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Format a stored `game` row into the wire shape the web client expects.
 * Kept in one place so the `/resolve`, `/`, and `/:slug` endpoints all
 * serialise identically — any field added to `game` lands here once.
 */
function serialiseGame(row: typeof game.$inferSelect) {
  return {
    id: row.id,
    steamgriddbId: row.steamgriddbId,
    name: row.name,
    slug: row.slug,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
    heroUrl: row.heroUrl,
    logoUrl: row.logoUrl,
  }
}

/**
 * Translate a SGDB client error into an appropriate HTTP status. Keeps
 * route handlers clean of nested try/catch — they just re-throw and
 * this helper picks the code.
 */
function sgdbErrorResponse(
  err: unknown
):
  | { status: 503; error: string }
  | { status: 502; error: string }
  | { status: 500; error: string } {
  if (err instanceof SteamGridDBNotConfiguredError) {
    return { status: 503, error: err.message }
  }
  if (err instanceof SteamGridDBError) {
    return { status: 502, error: err.message }
  }
  return {
    status: 500,
    error: err instanceof Error ? err.message : "Unknown error",
  }
}

// ─── Routes ────────────────────────────────────────────────────────────

export const gamesRoute = new Hono()
  /**
   * GET /api/games/status — integration configuration flag, cheap call.
   * The upload modal hits this once on mount to decide whether to
   * render the SGDB-backed game picker or the disabled placeholder.
   * Doesn't require admin — the answer is a boolean, not the key.
   */
  .get("/status", (c) => {
    return c.json({ steamgriddbConfigured: isConfigured() })
  })

  /**
   * GET /api/games/search?q=... — SGDB autocomplete proxy. Forwards the
   * query through our server (so the API key stays hidden) and returns
   * SGDB's raw search results. The upload modal uses this to populate
   * its game picker; the user's pick becomes the `steamgriddbId` it
   * later posts to /resolve.
   */
  .get(
    "/search",
    requireSession,
    zValidator("query", SearchQuery),
    async (c) => {
      const { q } = c.req.valid("query")
      try {
        const results = await searchGames(q)
        return c.json(results)
      } catch (err) {
        const { status, error } = sgdbErrorResponse(err)
        return c.json({ error }, status)
      }
    }
  )

  /**
   * POST /api/games/resolve — upsert a `game` row for an SGDB id. If
   * the row already exists, returns it as-is (no SGDB round trip — the
   * upload path must stay fast). Otherwise fetches game detail plus
   * hero+logo from SGDB in parallel, generates a unique slug, and
   * inserts.
   *
   * Returns the full row so the client can show the hero preview in
   * the upload modal without a follow-up GET.
   */
  .post(
    "/resolve",
    requireSession,
    zValidator("json", ResolveBody),
    async (c) => {
      const { steamgriddbId } = c.req.valid("json")

      const [existing] = await db
        .select()
        .from(game)
        .where(eq(game.steamgriddbId, steamgriddbId))
        .limit(1)
      if (existing) return c.json(serialiseGame(existing))

      let detail: Awaited<ReturnType<typeof getGameById>>
      let assets: Awaited<ReturnType<typeof getGameAssets>>
      try {
        // Fire both SGDB calls in parallel; the detail lookup is the
        // one that 404s on unknown ids, so we branch on its result.
        ;[detail, assets] = await Promise.all([
          getGameById(steamgriddbId),
          getGameAssets(steamgriddbId),
        ])
      } catch (err) {
        const { status, error } = sgdbErrorResponse(err)
        return c.json({ error }, status)
      }
      if (!detail) {
        return c.json({ error: "Unknown SteamGridDB game id" }, 404)
      }

      const slug = await generateUniqueGameSlug(detail.name)
      const releaseDate =
        detail.release_date != null
          ? new Date(detail.release_date * 1000)
          : null

      // `onConflictDoNothing` handles the race where two uploaders
      // resolve the same never-before-seen game id at the same time —
      // one wins the insert, the other re-reads on the fallback.
      const [inserted] = await db
        .insert(game)
        .values({
          steamgriddbId,
          name: detail.name,
          slug,
          releaseDate,
          heroUrl: assets.heroUrl,
          logoUrl: assets.logoUrl,
        })
        .onConflictDoNothing({ target: game.steamgriddbId })
        .returning()

      if (inserted) return c.json(serialiseGame(inserted))

      const [raced] = await db
        .select()
        .from(game)
        .where(eq(game.steamgriddbId, steamgriddbId))
        .limit(1)
      if (!raced) {
        // Insert reported nothing *and* no row landed — shouldn't
        // happen, but bail with a 500 rather than a silent null.
        return c.json({ error: "Failed to upsert game" }, 500)
      }
      return c.json(serialiseGame(raced))
    }
  )

  /**
   * GET /api/games — every game that has at least one ready,
   * non-private clip. Returns one row per game with aggregated
   * `clipCount` so the /games page can render the landscape grid
   * sorted by popularity. Games with no visible clips are filtered
   * out — a resolved-but-never-uploaded row would otherwise leak
   * empty cards into the listing.
   */
  .get("/", async (c) => {
    const rows = await db
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
      .groupBy(game.id)
      .orderBy(sql`count(${clip.id}) desc`, game.name)

    return c.json(
      rows.map((row) => ({
        id: row.id,
        steamgriddbId: row.steamgriddbId,
        name: row.name,
        slug: row.slug,
        releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
        heroUrl: row.heroUrl,
        logoUrl: row.logoUrl,
        clipCount: row.clipCount,
      }))
    )
  })

  /**
   * GET /api/games/:slug — game detail for the /g/:slug page's banner.
   * Doesn't include clips — the clip grid is a separate endpoint so
   * pagination doesn't force a re-fetch of the hero/logo URLs.
   */
  .get("/:slug", zValidator("param", SlugParam), async (c) => {
    const { slug } = c.req.valid("param")
    const [row] = await db
      .select()
      .from(game)
      .where(eq(game.slug, slug))
      .limit(1)
    if (!row) return c.json({ error: "Not found" }, 404)
    return c.json(serialiseGame(row))
  })

  /**
   * GET /api/games/:slug/clips — paginated clip list for the game
   * detail page's 5-column grid. Same shape as the home feed so the
   * existing ClipCard component drops in without adaptation.
   */
  .get(
    "/:slug/clips",
    zValidator("param", SlugParam),
    zValidator("query", ClipsQuery),
    async (c) => {
      const { slug } = c.req.valid("param")
      const { sort, cursor, limit } = c.req.valid("query")

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.slug, slug))
        .limit(1)
      if (!gameRow) return c.json({ error: "Not found" }, 404)

      const conditions: SQL[] = [
        eq(clip.gameId, gameRow.id),
        eq(clip.status, "ready"),
        inArray(clip.privacy, ["public", "unlisted"]),
      ]
      if (cursor) {
        conditions.push(lt(clip.createdAt, new Date(cursor)))
      }

      const orderBy =
        sort === "top"
          ? [desc(clip.likeCount), desc(clip.createdAt)]
          : [desc(clip.createdAt)]

      const rows = await db
        .select(clipSelectShape)
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .leftJoin(game, eq(clip.gameId, game.id))
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(limit)

      return c.json(rows)
    }
  )

  /**
   * GET /api/games/:slug/top-clips?limit=5 — weighted "best of" for the
   * banner strip. Ranking is HN-style: views + likes×3 as the raw
   * signal, divided by (ageInDays + 2)^1.5 for gravity. Multiplier on
   * likes reflects that likes are scarcer than views; the gravity
   * factor keeps a year-old mega-hit from permanently camping the top
   * slot. Done in SQL so we never pull the full clip set into node.
   */
  .get(
    "/:slug/top-clips",
    zValidator("param", SlugParam),
    zValidator("query", TopQuery),
    async (c) => {
      const { slug } = c.req.valid("param")
      const { limit } = c.req.valid("query")

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.slug, slug))
        .limit(1)
      if (!gameRow) return c.json({ error: "Not found" }, 404)

      const score = sql<number>`
        ((${clip.viewCount} + ${clip.likeCount} * 3)::float)
        / power(
            extract(epoch from (now() - ${clip.createdAt})) / 86400.0 + 2.0,
            1.5
          )
      `

      const rows = await db
        .select(clipSelectShape)
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .leftJoin(game, eq(clip.gameId, game.id))
        .where(
          and(
            eq(clip.gameId, gameRow.id),
            eq(clip.status, "ready"),
            inArray(clip.privacy, ["public", "unlisted"])
          )
        )
        .orderBy(desc(score))
        .limit(limit)

      return c.json(rows)
    }
  )
