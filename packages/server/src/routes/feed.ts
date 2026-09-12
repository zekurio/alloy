import { UNCATEGORISED_GAME_ID, MEDIA_FILTERS } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { user } from "@alloy/db/auth-schema"
import { clip, clipView, game } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { clipSelection } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { gameSelection, serialiseGameRow } from "@alloy/server/games/ref"
import { badRequest, invalidCursor } from "@alloy/server/runtime/http-response"
import { and, eq, isNull, ne, type SQL, sql } from "drizzle-orm"
import { Hono } from "hono"

import {
  clipListCursorCondition,
  clipListOrderBy,
  clipListPage,
  parseClipListCursor,
  publicClipListingConditions,
} from "./clips-helpers"
import {
  listRecommendedClips,
  parseRecommendedClipCursor,
} from "./feed-recommendations"
import { limitQueryParam, tbValidator } from "./validation"

const FilterEnum = t.enum(["all", "game"])
const FeedSortEnum = t.enum(["top", "recent", "recommended"])

const FeedQuery = t
  .object({
    filter: FilterEnum.$default("all"),
    media: t.enum(MEDIA_FILTERS).$default("video"),
    sort: FeedSortEnum.$default("recent"),
    gameId: t.uuid().optional(),
    authorId: t.uuid().optional(),
    excludeClipId: t.uuid().optional(),
    limit: limitQueryParam(50, 20),
    cursor: t.string().optional(),
  })
  .refine((v) => v.filter !== "game" || v.gameId !== undefined, {
    message: "gameId is required when filter=game",
    path: ["gameId"],
  })

const ChipsQuery = t.object({
  media: t.enum(MEDIA_FILTERS).$default("video"),
  limit: limitQueryParam(40, 20),
})

export const feedRoute = new Hono()
  .get("/", tbValidator("query", FeedQuery), async (c) => {
    const {
      filter,
      media,
      sort,
      gameId,
      authorId,
      excludeClipId,
      limit,
      cursor: rawCursor,
    } = c.req.valid("query")

    const session = await getSession(c)
    const viewerId = session?.user.status === "active" ? session.user.id : null

    const conditions: SQL[] = publicClipListingConditions(media)
    if (excludeClipId) conditions.push(ne(clip.id, excludeClipId))

    if (filter === "game") {
      if (!gameId) return badRequest(c, "gameId is required")
      conditions.push(
        gameId === UNCATEGORISED_GAME_ID
          ? isNull(clip.game_id)
          : eq(clip.game_id, gameId),
      )
      if (authorId) conditions.push(eq(clip.author_id, authorId))
    }

    if (sort === "recommended") {
      const cursor = parseRecommendedClipCursor(rawCursor)
      if (rawCursor && !cursor) return invalidCursor(c)
      return c.json(
        await listRecommendedClips({ conditions, cursor, limit, viewerId }),
      )
    }

    const cursor = parseClipListCursor(rawCursor, sort)
    if (rawCursor && !cursor) return invalidCursor(c)

    const cursorCondition = clipListCursorCondition(cursor, sort)
    if (cursorCondition) conditions.push(cursorCondition)

    const rows = await db
      .select(clipSelection)
      .from(clip)
      .innerJoin(user, eq(clip.author_id, user.id))
      .leftJoin(game, eq(clip.game_id, game.id))
      .where(and(...conditions))
      .orderBy(...clipListOrderBy(sort))
      .limit(limit + 1)

    return c.json(clipListPage(rows, limit, sort))
  })
  .get("/chips", tbValidator("query", ChipsQuery), async (c) => {
    const { limit, media } = c.req.valid("query")

    const session = await getSession(c)
    const viewerId = session?.user.status === "active" ? session.user.id : null
    const vid = viewerId ?? null

    const interaction = sql<number>`(count(distinct ${clipView.clip_id}))::int`
    const clipCount = sql<number>`(count(distinct ${clip.id}))::int`
    // Chips mirror the "All" feed, which includes the viewer's own clips, so
    // a game you've only posted in yourself still gets a chip. Views weight
    // the games you watch ahead of other games.
    const conditions: SQL[] = publicClipListingConditions(media)

    const rows = await db
      .select({
        ...gameSelection,
        interaction,
        clipCount,
      })
      .from(clip)
      .innerJoin(user, eq(clip.author_id, user.id))
      .innerJoin(game, eq(clip.game_id, game.id))
      .leftJoin(
        clipView,
        and(
          eq(clipView.clip_id, clip.id),
          sql`${clipView.user_id} = ${vid}::uuid`,
        ),
      )
      .where(and(...conditions))
      .groupBy(game.id)
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
