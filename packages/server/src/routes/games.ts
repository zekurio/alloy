import {
  type GameRow,
  UNCATEGORISED_GAME_ID,
  UNCATEGORISED_GAME_NAME,
  UNCATEGORISED_GAME_SLUG,
} from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, game, gameFollow } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { getSession } from "@alloy/server/auth/session"
import { db } from "@alloy/server/db/index"
import { lookupGamesByName } from "@alloy/server/games/lookup"
import {
  gameSelectShape,
  getSteamGridDBGameRef,
  getSteamGridDBGameRefBySlug,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import {
  enrichSearchResultsWithIcons,
  isConfigured,
  searchGames,
} from "@alloy/server/games/steamgriddb"
import {
  badRequest,
  booleanFlag,
  errorResult,
  steamgriddbStatus,
  notFound,
} from "@alloy/server/runtime/http-response"
import { and, desc, eq, ilike, isNull, type SQL, sql } from "drizzle-orm"
import { type Context, Hono } from "hono"
import { z } from "zod"

import { publicClipListingConditions } from "./clips-helpers"
import {
  GamesListQuery,
  LookupBody,
  ResolveBody,
  SearchQuery,
  steamgriddbErrorResponse,
  SlugParam,
} from "./games-helpers"
import { limitQueryParam, zValidator } from "./validation"

const CreatorsQuery = z.object({
  limit: limitQueryParam(24, 12),
})

type ResolvedGameRef =
  | { row: GameRow; response?: never }
  | { row?: never; response: Response }

async function resolveSteamGridDBGameRef(
  c: Context,
  steamgriddbId: number,
): Promise<ResolvedGameRef> {
  try {
    const row = await getSteamGridDBGameRef(steamgriddbId)
    if (!row) return { response: notFound(c, "Unknown SteamGridDB game id") }
    return { row }
  } catch (err) {
    return { response: errorResult(c, steamgriddbErrorResponse(err)) }
  }
}

async function resolveSteamGridDBGameRefBySlug(
  c: Context,
  slug: string,
): Promise<ResolvedGameRef> {
  try {
    const row = await getSteamGridDBGameRefBySlug(slug)
    if (!row) return { response: notFound(c, "Unknown SteamGridDB game slug") }
    return { row }
  } catch (err) {
    return { response: errorResult(c, steamgriddbErrorResponse(err)) }
  }
}

async function resolveSteamGridDBGameRefByParam(
  c: Context,
  value: string,
): Promise<ResolvedGameRef> {
  if (value === UNCATEGORISED_GAME_SLUG || value === UNCATEGORISED_GAME_ID) {
    return { row: uncategorisedGameRow() }
  }

  const steamgriddbId = Number.parseInt(value, 10)
  if (
    String(steamgriddbId) === value &&
    Number.isSafeInteger(steamgriddbId) &&
    steamgriddbId > 0
  ) {
    return resolveSteamGridDBGameRef(c, steamgriddbId)
  }

  return resolveSteamGridDBGameRefBySlug(c, value)
}

export const gamesRoute = new Hono()
  .get("/status", (c) => {
    return steamgriddbStatus(c, isConfigured())
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
          results.length,
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
    zValidator("query", SearchQuery),
    async (c) => {
      const { q } = c.req.valid("query")
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`
      const rows = await db
        .select(gameSelectShape)
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
    zValidator("json", ResolveBody),
    async (c) => {
      const { steamgriddbId } = c.req.valid("json")
      const resolved = await resolveSteamGridDBGameRef(c, steamgriddbId)
      if (resolved.response) return resolved.response
      return c.json(resolved.row)
    },
  )
  .post(
    "/lookup",
    requireSession,
    zValidator("json", LookupBody),
    async (c) => {
      const { names } = c.req.valid("json")
      return c.json(await lookupGamesByName(names, c.var.viewerId))
    },
  )
  .get("/", zValidator("query", GamesListQuery), async (c) => {
    const { limit, offset } = c.req.valid("query")
    const uncategorisedCount = await publicUncategorisedClipCount()
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
              ...gameSelectShape,
              clipCount: sql<number>`count(${clip.id})::int`,
            })
            .from(game)
            .innerJoin(clip, eq(clip.game_id, game.id))
            .innerJoin(user, eq(clip.author_id, user.id))
            .where(and(...publicClipListingConditions()))
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
  .get("/:slug", zValidator("param", SlugParam), async (c) => {
    const { slug } = c.req.valid("param")
    const resolved = await resolveSteamGridDBGameRefByParam(c, slug)
    if (resolved.response) return resolved.response
    const gameId = resolved.row.id

    if (gameId === UNCATEGORISED_GAME_ID) {
      return c.json({
        ...resolved.row,
        viewer: null,
        favouritesCount: 0,
        clipCount: await publicUncategorisedClipCount(),
      })
    }

    const session = await getSession(c)
    let viewer: { isFollowing: boolean } | null = null
    if (session) {
      const [followRow] = await db
        .select({ id: gameFollow.id })
        .from(gameFollow)
        .where(
          and(
            eq(gameFollow.user_id, session.user.id),
            eq(gameFollow.game_id, gameId),
          ),
        )
        .limit(1)
      viewer = { isFollowing: followRow !== undefined }
    }

    const [{ value: favouritesCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(gameFollow)
      .innerJoin(user, eq(user.id, gameFollow.user_id))
      .where(and(eq(gameFollow.game_id, gameId), isNull(user.disabled_at)))

    const [{ value: clipCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(clip)
      .innerJoin(user, eq(clip.author_id, user.id))
      .where(and(eq(clip.game_id, gameId), ...publicClipListingConditions()))

    return c.json({
      ...resolved.row,
      viewer,
      favouritesCount,
      clipCount,
    })
  })
  .get(
    "/:slug/creators",
    zValidator("param", SlugParam),
    zValidator("query", CreatorsQuery),
    async (c) => {
      const { slug } = c.req.valid("param")
      const { limit } = c.req.valid("query")
      const resolved = await resolveSteamGridDBGameRefByParam(c, slug)
      if (resolved.response) return resolved.response
      const gameCondition: SQL =
        resolved.row.id === UNCATEGORISED_GAME_ID
          ? isNull(clip.game_id)
          : eq(clip.game_id, resolved.row.id)

      const creators = await db
        .select({
          id: user.id,
          username: user.username,
          image: user.image,
          clipCount: sql<number>`count(*)::int`,
        })
        .from(clip)
        .innerJoin(user, eq(clip.author_id, user.id))
        .where(and(gameCondition, ...publicClipListingConditions()))
        .groupBy(user.id, user.username, user.image)
        .orderBy(desc(sql`count(*)`), user.username)
        .limit(limit)

      return c.json({ creators })
    },
  )
  .post(
    "/:slug/follow",
    requireSession,
    zValidator("param", SlugParam),
    async (c) => {
      const { slug } = c.req.valid("param")
      const viewerId = c.var.viewerId
      const resolved = await resolveSteamGridDBGameRefByParam(c, slug)
      if (resolved.response) return resolved.response
      if (resolved.row.id === UNCATEGORISED_GAME_ID) {
        return badRequest(c, "Uncategorised cannot be followed")
      }

      await db
        .insert(gameFollow)
        .values({ user_id: viewerId, game_id: resolved.row.id })
        .onConflictDoNothing()

      return booleanFlag(c, "following", true)
    },
  )
  .delete(
    "/:slug/follow",
    requireSession,
    zValidator("param", SlugParam),
    async (c) => {
      const { slug } = c.req.valid("param")
      const viewerId = c.var.viewerId
      const resolved = await resolveSteamGridDBGameRefByParam(c, slug)
      if (resolved.response) return resolved.response
      if (resolved.row.id === UNCATEGORISED_GAME_ID) {
        return badRequest(c, "Uncategorised cannot be followed")
      }

      await db
        .delete(gameFollow)
        .where(
          and(
            eq(gameFollow.user_id, viewerId),
            eq(gameFollow.game_id, resolved.row.id),
          ),
        )

      return booleanFlag(c, "following", false)
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

async function publicUncategorisedClipCount(): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .where(and(isNull(clip.game_id), ...publicClipListingConditions()))
  return rows[0]?.value ?? 0
}
