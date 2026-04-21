import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { getAuth } from "../auth"
import { user } from "@workspace/db/auth-schema"
import { clip, game, gameFollow } from "@workspace/db/schema"

import { db } from "../db"
import { clipSelectShape } from "../lib/clip-select"
import { generateUniqueGameSlug } from "../lib/game-slug"
import { requireSession } from "../lib/require-session"
import {
  enrichSearchResultsWithIcons,
  getGameAssets,
  getGameById,
  isConfigured,
  searchGames,
} from "../lib/steamgriddb"
import { serialiseGame, sgdbErrorResponse } from "./games-helpers"

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

  .get(
    "/search",
    requireSession,
    zValidator("query", SearchQuery),
    async (c) => {
      const { q } = c.req.valid("query")
      try {
        const results = await searchGames(q)
        const enriched = await enrichSearchResultsWithIcons(
          results,
          results.length
        )
        return c.json(enriched)
      } catch (err) {
        const { status, error } = sgdbErrorResponse(err)
        return c.json({ error }, status)
      }
    }
  )

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

      const [inserted] = await db
        .insert(game)
        .values({
          steamgriddbId,
          name: detail.name,
          slug,
          releaseDate,
          heroUrl: assets.heroUrl,
          logoUrl: assets.logoUrl,
          iconUrl: assets.iconUrl,
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
        iconUrl: row.iconUrl,
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

    const session = await getAuth().api.getSession({
      headers: c.req.raw.headers,
    })
    let viewer: { isFollowing: boolean } | null = null
    if (session) {
      const [followRow] = await db
        .select({ id: gameFollow.id })
        .from(gameFollow)
        .where(
          and(
            eq(gameFollow.userId, session.user.id),
            eq(gameFollow.gameId, row.id)
          )
        )
        .limit(1)
      viewer = { isFollowing: followRow !== undefined }
    }

    return c.json({ ...serialiseGame(row), viewer })
  })

  .get("/:slug/hero", zValidator("param", SlugParam), async (c) => {
    const { slug } = c.req.valid("param")
    const [row] = await db
      .select({ heroUrl: game.heroUrl })
      .from(game)
      .where(eq(game.slug, slug))
      .limit(1)
    if (!row || !row.heroUrl) return c.json({ error: "Not found" }, 404)

    const upstream = await fetch(row.heroUrl)
    if (!upstream.ok || !upstream.body) {
      return c.json({ error: "Upstream hero unavailable" }, 502)
    }

    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/*",
        "cache-control": "public, max-age=86400",
      },
    })
  })

  .post(
    "/:slug/follow",
    requireSession,
    zValidator("param", SlugParam),
    async (c) => {
      const { slug } = c.req.valid("param")
      const viewerId = c.var.viewerId

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.slug, slug))
        .limit(1)
      if (!gameRow) return c.json({ error: "Not found" }, 404)

      // Unique index on (userId, gameId) keeps this idempotent — a
      // second POST collapses to the existing edge.
      await db
        .insert(gameFollow)
        .values({ userId: viewerId, gameId: gameRow.id })
        .onConflictDoNothing()

      return c.json({ following: true })
    }
  )

  .delete(
    "/:slug/follow",
    requireSession,
    zValidator("param", SlugParam),
    async (c) => {
      const { slug } = c.req.valid("param")
      const viewerId = c.var.viewerId

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.slug, slug))
        .limit(1)
      if (!gameRow) return c.json({ error: "Not found" }, 404)

      await db
        .delete(gameFollow)
        .where(
          and(
            eq(gameFollow.userId, viewerId),
            eq(gameFollow.gameId, gameRow.id)
          )
        )

      return c.json({ following: false })
    }
  )

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
