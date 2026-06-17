import { sanitizeTag } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipTag, game } from "@alloy/db/schema"
import { clipSelectShape } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { gameSelectShape, serialiseGameRow } from "@alloy/server/games/ref"
import { invalidCursor, notFound } from "@alloy/server/runtime/http-response"
import { and, eq, gte, isNull, type SQL, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import {
  clipListCursorCondition,
  clipListOrderBy,
  clipListPage,
  parseClipListCursor,
  publicClipPrivacyCondition,
  WINDOW_MS,
} from "./clips-helpers"
import { serialiseGameListRow } from "./games-helpers"
import { clipTagFilter } from "./tag-filter"
import { limitQueryParam, zValidator } from "./validation"

const TagParam = z.object({ tag: z.string().min(1).max(64) })

const TagSearchQuery = z.object({ q: z.string().min(1).max(64) })

/** How many tag suggestions the autocomplete returns. */
const TAG_SUGGESTION_LIMIT = 8

const TagClipsQuery = z.object({
  window: z.enum(["today", "week", "month", "year", "all"]).optional(),
  sort: z.enum(["top", "recent"]).default("top"),
  steamgriddbId: z.coerce.number().int().positive().optional(),
  limit: limitQueryParam(100, 50),
  cursor: z.string().optional(),
})

function publicTagClipConditions(tag: string): SQL[] {
  return [
    eq(clip.status, "ready"),
    publicClipPrivacyCondition(),
    isNull(user.disabledAt),
    clipTagFilter(tag),
  ]
}

export const tagsRoute = new Hono()
  // Prefix autocomplete for the editor. Ranks by how many public clips use a
  // tag so the most useful suggestions surface first.
  .get("/", zValidator("query", TagSearchQuery), async (c) => {
    const prefix = sanitizeTag(c.req.valid("query").q)
    if (!prefix) return c.json({ tags: [] })
    // `_` survives sanitizing and is a LIKE wildcard, so escape it.
    const like = `${prefix.replace(/[\\%_]/g, "\\$&")}%`
    const usage = sql<number>`count(distinct ${clip.id})::int`

    const rows = await db
      .select({ tag: clipTag.tag, usage })
      .from(clipTag)
      .innerJoin(clip, eq(clipTag.clipId, clip.id))
      .innerJoin(user, eq(clip.authorId, user.id))
      .where(
        and(
          eq(clip.status, "ready"),
          publicClipPrivacyCondition(),
          isNull(user.disabledAt),
          sql`${clipTag.tag} like ${like} escape '\\'`,
        ),
      )
      .groupBy(clipTag.tag)
      .orderBy(sql`${usage} desc`, clipTag.tag)
      .limit(TAG_SUGGESTION_LIMIT)

    return c.json({ tags: rows.map((row) => row.tag) })
  })
  .get(
    "/:tag/clips",
    zValidator("param", TagParam),
    zValidator("query", TagClipsQuery),
    async (c) => {
      const tag = sanitizeTag(c.req.valid("param").tag)
      if (!tag) return notFound(c)
      const { window, sort, steamgriddbId, cursor, limit } =
        c.req.valid("query")

      const parsedCursor = parseClipListCursor(cursor, sort)
      if (cursor && !parsedCursor) return invalidCursor(c)

      const conditions = publicTagClipConditions(tag)
      if (steamgriddbId) {
        conditions.push(eq(clip.steamgriddbId, steamgriddbId))
      }
      if (window && window !== "all") {
        conditions.push(
          gte(clip.createdAt, new Date(Date.now() - WINDOW_MS[window])),
        )
      }
      const cursorCondition = clipListCursorCondition(parsedCursor, sort)
      if (cursorCondition) conditions.push(cursorCondition)

      const rows = await db
        .select(clipSelectShape)
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .leftJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
        .where(and(...conditions))
        .orderBy(...clipListOrderBy(sort))
        .limit(limit + 1)

      return c.json(clipListPage(rows, limit, sort))
    },
  )
  .get("/:tag/games", zValidator("param", TagParam), async (c) => {
    const tag = sanitizeTag(c.req.valid("param").tag)
    if (!tag) return notFound(c)

    const conditions = publicTagClipConditions(tag)
    const [summary, rows] = await Promise.all([
      db
        .select({ clipCount: sql<number>`count(${clip.id})::int` })
        .from(clip)
        .innerJoin(user, eq(clip.authorId, user.id))
        .where(and(...conditions)),
      db
        .select({
          ...gameSelectShape,
          clipCount: sql<number>`count(${clip.id})::int`,
        })
        .from(game)
        .innerJoin(clip, eq(clip.steamgriddbId, game.steamgriddbId))
        .innerJoin(user, eq(clip.authorId, user.id))
        .where(and(...conditions))
        .groupBy(game.steamgriddbId)
        .orderBy(sql`count(${clip.id}) desc`, game.name),
    ])

    return c.json({
      clipCount: summary[0]?.clipCount ?? 0,
      games: rows.map((row) =>
        serialiseGameListRow({
          ...serialiseGameRow(row),
          clipCount: row.clipCount,
        }),
      ),
    })
  })
