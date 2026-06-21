import type { GameRow } from "@alloy/contracts"
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
  booleanFlag,
  errorResult,
  steamgriddbStatus,
  notFound,
} from "@alloy/server/runtime/http-response"
import { and, eq, isNull, sql } from "drizzle-orm"
import { type Context, Hono } from "hono"

import { publicClipListingConditions } from "./clips-helpers"
import {
  GamesListQuery,
  LookupBody,
  ResolveBody,
  SearchQuery,
  serialiseGame,
  serialiseGameListRow,
  steamgriddbErrorResponse,
  SlugParam,
} from "./games-helpers"
import { zValidator } from "./validation"

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
  .post(
    "/resolve",
    requireSession,
    zValidator("json", ResolveBody),
    async (c) => {
      const { steamgriddbId } = c.req.valid("json")
      const resolved = await resolveSteamGridDBGameRef(c, steamgriddbId)
      if (resolved.response) return resolved.response
      return c.json(serialiseGame(resolved.row))
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
    const rows = await db
      .select({
        ...gameSelectShape,
        clipCount: sql<number>`count(${clip.id})::int`,
      })
      .from(game)
      .innerJoin(clip, eq(clip.steamgriddb_id, game.steamgriddb_id))
      .innerJoin(user, eq(clip.author_id, user.id))
      .where(and(...publicClipListingConditions()))
      .groupBy(game.steamgriddb_id)
      .orderBy(sql`count(${clip.id}) desc`, game.name)
      .limit(limit)
      .offset(offset)

    return c.json(
      rows.map((row) =>
        serialiseGameListRow({
          ...serialiseGameRow(row),
          clipCount: row.clipCount,
        }),
      ),
    )
  })
  .get("/:slug", zValidator("param", SlugParam), async (c) => {
    const { slug } = c.req.valid("param")
    const resolved = await resolveSteamGridDBGameRefByParam(c, slug)
    if (resolved.response) return resolved.response
    const { steamgriddbId } = resolved.row

    const session = await getSession(c)
    let viewer: { isFollowing: boolean } | null = null
    if (session) {
      const [followRow] = await db
        .select({ id: gameFollow.id })
        .from(gameFollow)
        .where(
          and(
            eq(gameFollow.user_id, session.user.id),
            eq(gameFollow.steamgriddb_id, steamgriddbId),
          ),
        )
        .limit(1)
      viewer = { isFollowing: followRow !== undefined }
    }

    const [{ value: favouritesCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(gameFollow)
      .innerJoin(user, eq(user.id, gameFollow.user_id))
      .where(
        and(
          eq(gameFollow.steamgriddb_id, steamgriddbId),
          isNull(user.disabled_at),
        ),
      )

    const [{ value: clipCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(clip)
      .innerJoin(user, eq(clip.author_id, user.id))
      .where(
        and(
          eq(clip.steamgriddb_id, steamgriddbId),
          ...publicClipListingConditions(),
        ),
      )

    return c.json({
      ...serialiseGame(resolved.row),
      viewer,
      favouritesCount,
      clipCount,
    })
  })
  .post(
    "/:slug/follow",
    requireSession,
    zValidator("param", SlugParam),
    async (c) => {
      const { slug } = c.req.valid("param")
      const viewerId = c.var.viewerId
      const resolved = await resolveSteamGridDBGameRefByParam(c, slug)
      if (resolved.response) return resolved.response
      const { steamgriddbId } = resolved.row

      await db
        .insert(gameFollow)
        .values({ user_id: viewerId, steamgriddb_id: steamgriddbId })
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
      const { steamgriddbId } = resolved.row

      await db
        .delete(gameFollow)
        .where(
          and(
            eq(gameFollow.user_id, viewerId),
            eq(gameFollow.steamgriddb_id, steamgriddbId),
          ),
        )

      return booleanFlag(c, "following", false)
    },
  )
