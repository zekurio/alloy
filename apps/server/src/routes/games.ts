import { zValidator } from "./validation"
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { Hono, type Context } from "hono"

import { user } from "@workspace/db/auth-schema"
import { clip, game, gameFollow } from "@workspace/db/schema"

import { db } from "../db"
import { getSession } from "../auth/session"
import { clipSelectShape, toPublicClipRow } from "../clips/select"
import { generateUniqueGameSlug } from "../games/slug"
import { requireSession } from "../auth/require-session"
import {
  badGateway,
  booleanFlag,
  errorResult,
  internalServerError,
  invalidCursor,
  notFound,
  steamGridDBStatus,
} from "../runtime/http-response"
import {
  clipListCursorCondition,
  clipListOrderBy,
  clipListPage,
  parseClipListCursor,
} from "./clips-helpers"
import {
  enrichSearchResultsWithIcons,
  getGameAssets,
  getGameById,
  isConfigured,
  searchGames,
} from "../games/steamgriddb"
import {
  ClipsQuery,
  GamesListQuery,
  ResolveBody,
  SearchQuery,
  SlugParam,
  TopQuery,
  serialiseGame,
  serialiseGameListRow,
  sgdbErrorResponse,
} from "./games-helpers"

type GameImageAsset = {
  column: "heroUrl" | "gridUrl"
  label: "hero" | "grid"
}

async function proxyGameImageAsset(
  c: Context,
  slug: string,
  asset: GameImageAsset
) {
  const [row] = await db
    .select({ url: game[asset.column] })
    .from(game)
    .where(eq(game.slug, slug))
    .limit(1)
  if (!row?.url) return notFound(c)

  const upstream = await fetch(row.url)
  if (!upstream.ok || !upstream.body) {
    return badGateway(c, `Upstream ${asset.label} unavailable`)
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/*",
      "cache-control": "public, max-age=86400",
    },
  })
}

export const gamesRoute = new Hono()
  .get("/status", (c) => {
    return steamGridDBStatus(c, isConfigured())
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
        return errorResult(c, sgdbErrorResponse(err))
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
        ;[detail, assets] = await Promise.all([
          getGameById(steamgriddbId),
          getGameAssets(steamgriddbId),
        ])
      } catch (err) {
        return errorResult(c, sgdbErrorResponse(err))
      }
      if (!detail) {
        return notFound(c, "Unknown SteamGridDB game id")
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
          gridUrl: assets.gridUrl,
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
        return internalServerError(c, "Failed to upsert game")
      }
      return c.json(serialiseGame(raced))
    }
  )

  .get("/", zValidator("query", GamesListQuery), async (c) => {
    const { limit, offset } = c.req.valid("query")
    const rows = await db
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
          inArray(clip.privacy, ["public", "unlisted"])
        )
      )
      .innerJoin(user, eq(clip.authorId, user.id))
      .where(isNull(user.disabledAt))
      .groupBy(game.id)
      .orderBy(sql`count(${clip.id}) desc`, game.name)
      .limit(limit)
      .offset(offset)

    return c.json(rows.map(serialiseGameListRow))
  })

  .get("/:slug", zValidator("param", SlugParam), async (c) => {
    const { slug } = c.req.valid("param")
    const [row] = await db
      .select()
      .from(game)
      .where(eq(game.slug, slug))
      .limit(1)
    if (!row) return notFound(c)

    const session = await getSession(c)
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

    const [{ value: favouritesCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(gameFollow)
      .innerJoin(user, eq(user.id, gameFollow.userId))
      .where(and(eq(gameFollow.gameId, row.id), isNull(user.disabledAt)))

    return c.json({ ...serialiseGame(row), viewer, favouritesCount })
  })

  .get("/:slug/hero", zValidator("param", SlugParam), async (c) => {
    const { slug } = c.req.valid("param")
    return proxyGameImageAsset(c, slug, { column: "heroUrl", label: "hero" })
  })

  .get("/:slug/grid", zValidator("param", SlugParam), async (c) => {
    const { slug } = c.req.valid("param")
    return proxyGameImageAsset(c, slug, { column: "gridUrl", label: "grid" })
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
      if (!gameRow) return notFound(c)

      await db
        .insert(gameFollow)
        .values({ userId: viewerId, gameId: gameRow.id })
        .onConflictDoNothing()

      return booleanFlag(c, "following", true)
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
      if (!gameRow) return notFound(c)

      await db
        .delete(gameFollow)
        .where(
          and(
            eq(gameFollow.userId, viewerId),
            eq(gameFollow.gameId, gameRow.id)
          )
        )

      return booleanFlag(c, "following", false)
    }
  )

  .get(
    "/:slug/clips",
    zValidator("param", SlugParam),
    zValidator("query", ClipsQuery),
    async (c) => {
      const { slug } = c.req.valid("param")
      const { sort, cursor, limit } = c.req.valid("query")
      const parsedCursor = parseClipListCursor(cursor, sort)
      if (cursor && !parsedCursor) {
        return invalidCursor(c)
      }

      const [gameRow] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.slug, slug))
        .limit(1)
      if (!gameRow) return notFound(c)

      const conditions: SQL[] = [
        eq(clip.gameId, gameRow.id),
        eq(clip.status, "ready"),
        inArray(clip.privacy, ["public", "unlisted"]),
        isNull(user.disabledAt),
      ]
      const cursorCondition = clipListCursorCondition(parsedCursor, sort)
      if (cursorCondition) conditions.push(cursorCondition)

      const rows = await db
        .select(clipSelectShape)
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .leftJoin(game, eq(clip.gameId, game.id))
        .where(and(...conditions))
        .orderBy(...clipListOrderBy(sort))
        .limit(limit + 1)

      return c.json(clipListPage(rows, limit, sort))
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
      if (!gameRow) return notFound(c)

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
            inArray(clip.privacy, ["public", "unlisted"]),
            isNull(user.disabledAt)
          )
        )
        .orderBy(desc(score))
        .limit(limit)

      return c.json(rows.map(toPublicClipRow))
    }
  )
