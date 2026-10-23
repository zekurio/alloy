import {
  type GameRow,
  type MediaFilter,
  MEDIA_FILTERS,
  UNCATEGORISED_GAME_ID,
  UNCATEGORISED_GAME_NAME,
  UNCATEGORISED_GAME_SLUG,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { user } from "@alloy/db/auth-schema"
import { clip, game } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/session"
import { db } from "@alloy/server/db/index"
import { lookupGamesByName } from "@alloy/server/games/lookup"
import {
  findSteamGridDBGameRef,
  gameSelection,
  getSteamGridDBGameRef,
  getSteamGridDBGameRefBySlug,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import {
  enrichSearchResultsWithIcons,
  searchGames,
} from "@alloy/server/games/steamgriddb"
import { errorResult, notFound } from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { and, desc, eq, ilike, isNull, type SQL, sql } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"

import { publicClipListingConditions } from "./clips-helpers"
import {
  GamesListQuery,
  LookupBody,
  ResolveBody,
  SearchQuery,
  steamgriddbErrorResponse,
  SlugParam,
} from "./games-helpers"
import { limitQueryParam, tbValidator } from "./validation"

const MediaQuery = t.object({ media: t.enum(MEDIA_FILTERS).$default("video") })
const CreatorsQuery = t.object({
  media: t.enum(MEDIA_FILTERS).$default("video"),
  limit: limitQueryParam(24, 12),
})

// Icons for the first few autocomplete rows; the rest render without one.
// Known games answer from their rows, unknown ones cost SteamGridDB calls.
const SEARCH_ARTWORK_LIMIT = 12

// Creating catalogue rows costs several SteamGridDB calls each and is the
// only way signed-in users can grow the game table, so it is metered per
// viewer. Reads of existing rows are not.
const gameCreateRateLimit = rateLimiter<{ Variables: { viewerId: string } }>({
  windowMs: 60_000,
  max: 30,
  key: (c) => c.var.viewerId,
})

function parseSteamGridDBId(value: string): number | null {
  const id = Number.parseInt(value, 10)
  return String(id) === value && Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Loads the game named by the `:slug` param into `c.var.game`. The param is
 * a slug, a SteamGridDB id, or the uncategorised placeholder.
 */
const loadGameRef = createMiddleware<{ Variables: { game: GameRow } }>(
  async (c, next) => {
    const value = c.req.param("slug") ?? ""
    const steamgriddbId = parseSteamGridDBId(value)
    if (value === UNCATEGORISED_GAME_SLUG || value === UNCATEGORISED_GAME_ID) {
      c.set("game", uncategorisedGameRow())
    } else if (steamgriddbId !== null) {
      // Read routes only serve games the catalogue already has. Numeric links
      // to games nobody has attached a clip to answer 404 instead of
      // ingesting them.
      const row = await findSteamGridDBGameRef(steamgriddbId)
      if (!row) return notFound(c, "Unknown SteamGridDB game id")
      c.set("game", row)
    } else {
      let row: GameRow | null
      try {
        row = await getSteamGridDBGameRefBySlug(value)
      } catch (err) {
        return errorResult(c, steamgriddbErrorResponse(err))
      }
      if (!row) return notFound(c, "Unknown SteamGridDB game slug")
      c.set("game", row)
    }
    await next()
  },
)

export const gamesRoute = new Hono()
  .get(
    "/search",
    requireSession,
    tbValidator("query", SearchQuery),
    async (c) => {
      const { q } = c.req.valid("query")
      try {
        const results = await searchGames(q)
        const enriched = await enrichSearchResultsWithIcons(
          results,
          SEARCH_ARTWORK_LIMIT,
        )
        return c.json(enriched)
      } catch (err) {
        return errorResult(c, steamgriddbErrorResponse(err))
      }
    },
  )
  // Local catalogue search across all indexed games (custom + SteamGridDB),
  // including games with no clips yet. Powers the game picker so freshly
  // created custom games are selectable by id without a resolve round-trip.
  .get(
    "/local-search",
    requireSession,
    tbValidator("query", SearchQuery),
    async (c) => {
      const { q } = c.req.valid("query")
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`
      const rows = await db
        .select(gameSelection)
        .from(game)
        .where(ilike(game.name, pattern))
        .orderBy(game.name)
        .limit(12)
      return c.json(rows.map(serialiseGameRow))
    },
  )
  .post(
    "/resolve",
    requireSession,
    gameCreateRateLimit,
    tbValidator("json", ResolveBody),
    async (c) => {
      const { steamgriddbId } = c.req.valid("json")
      let row: GameRow | null
      try {
        row = await getSteamGridDBGameRef(steamgriddbId)
      } catch (err) {
        return errorResult(c, steamgriddbErrorResponse(err))
      }
      if (!row) return notFound(c, "Unknown SteamGridDB game id")
      return c.json(row)
    },
  )
  .post(
    "/lookup",
    requireSession,
    gameCreateRateLimit,
    tbValidator("json", LookupBody),
    async (c) => {
      const { names } = c.req.valid("json")
      return c.json(await lookupGamesByName(names, c.var.viewerId))
    },
  )
  .get("/", tbValidator("query", GamesListQuery), async (c) => {
    const { limit, offset, media } = c.req.valid("query")
    const uncategorisedCount = await publicUncategorisedClipCount(media)
    const includesUncategorised = uncategorisedCount > 0
    const regularLimit =
      includesUncategorised && offset === 0 ? limit - 1 : limit
    const regularOffset = includesUncategorised
      ? Math.max(0, offset - 1)
      : offset
    const rows =
      regularLimit > 0
        ? await db
            .select({
              ...gameSelection,
              clipCount: sql<number>`count(${clip.id})::int`,
            })
            .from(game)
            .innerJoin(clip, eq(clip.game_id, game.id))
            .innerJoin(user, eq(clip.author_id, user.id))
            .where(and(...publicClipListingConditions(media)))
            .groupBy(game.id)
            .orderBy(sql`count(${clip.id}) desc`, game.name)
            .limit(regularLimit)
            .offset(regularOffset)
        : []

    return c.json([
      ...(includesUncategorised && offset === 0
        ? [
            {
              ...uncategorisedGameRow(),
              clipCount: uncategorisedCount,
            },
          ]
        : []),
      ...rows.map((row) => ({
        ...serialiseGameRow(row),
        clipCount: row.clipCount,
      })),
    ])
  })
  .get(
    "/:slug",
    tbValidator("param", SlugParam),
    tbValidator("query", MediaQuery),
    loadGameRef,
    async (c) => {
      const { media } = c.req.valid("query")
      const gameId = c.var.game.id

      if (gameId === UNCATEGORISED_GAME_ID) {
        return c.json({
          ...c.var.game,
          clipCount: await publicUncategorisedClipCount(media),
        })
      }

      const [{ value: clipCount }] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(clip)
        .innerJoin(user, eq(clip.author_id, user.id))
        .where(
          and(eq(clip.game_id, gameId), ...publicClipListingConditions(media)),
        )

      return c.json({
        ...c.var.game,
        clipCount,
      })
    },
  )
  .get(
    "/:slug/creators",
    tbValidator("param", SlugParam),
    tbValidator("query", CreatorsQuery),
    loadGameRef,
    async (c) => {
      const { limit, media } = c.req.valid("query")
      const gameId = c.var.game.id
      const gameCondition: SQL =
        gameId === UNCATEGORISED_GAME_ID
          ? isNull(clip.game_id)
          : eq(clip.game_id, gameId)

      const creators = await db
        .select({
          id: user.id,
          username: user.username,
          image: user.image,
          clipCount: sql<number>`count(*)::int`,
        })
        .from(clip)
        .innerJoin(user, eq(clip.author_id, user.id))
        .where(and(gameCondition, ...publicClipListingConditions(media)))
        .groupBy(user.id, user.username, user.image)
        .orderBy(desc(sql`count(*)`), user.username)
        .limit(limit)

      return c.json({ creators })
    },
  )

function uncategorisedGameRow(): GameRow {
  return {
    id: UNCATEGORISED_GAME_ID,
    steamgriddbId: null,
    source: "custom",
    name: UNCATEGORISED_GAME_NAME,
    slug: UNCATEGORISED_GAME_SLUG,
    releaseDate: null,
    heroUrl: null,
    heroBlurHash: null,
    gridUrl: null,
    gridBlurHash: null,
    logoUrl: null,
    iconUrl: null,
  }
}

async function publicUncategorisedClipCount(
  media: MediaFilter,
): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .where(and(isNull(clip.game_id), ...publicClipListingConditions(media)))
  return rows[0]?.value ?? 0
}
