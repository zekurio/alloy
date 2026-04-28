import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, gte, inArray, isNull, lt, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { user } from "@workspace/db/auth-schema"
import { clip, game } from "@workspace/db/schema"

import { db } from "../db"
import { clipSelectShape, selectClipById } from "../clips/select"
import { selectQueueRowsForAuthor } from "../clips/queue-select"
import { requireSession } from "../auth/require-session"
import { clipCommentsRoutes } from "./clip-comments"
import { clipsEngagementRoutes } from "./clips-engagement"
import { IdParam, ListQuery, peekViewer, WINDOW_MS } from "./clips-helpers"
import { clipsPlaybackRoutes } from "./clips-playback"
import { clipsUploadRoutes } from "./clips-upload"

export const clips = new Hono()
  .get("/", zValidator("query", ListQuery), async (c) => {
    const { window, sort, cursor, limit } = c.req.valid("query")

    const conditions: SQL[] = [
      eq(clip.status, "ready"),
      inArray(clip.privacy, ["public", "unlisted"]),
      isNull(user.disabledAt),
    ]
    if (window && window !== "all") {
      conditions.push(
        gte(clip.createdAt, new Date(Date.now() - WINDOW_MS[window]))
      )
    }
    if (cursor) {
      conditions.push(lt(clip.createdAt, new Date(cursor)))
    }

    // Top: likes desc with createdAt tiebreak so a flood of zero-like
    // clips doesn't wedge the ordering. Recent: straight newest-first.
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
  })

  .get("/queue", requireSession, async (c) => {
    const viewerId = c.var.viewerId
    const rows = await selectQueueRowsForAuthor(viewerId)
    return c.json(rows)
  })

  .get("/:id", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const row = await selectClipById(id)
    if (!row) return c.json({ error: "Not found" }, 404)

    const viewer = await peekViewer(c.req.raw.headers)
    const isOwner = viewer?.id === row.authorId
    const isAdmin = viewer?.role === "admin"
    const isPrivate = row.privacy === "private"
    const [author] = await db
      .select({ disabledAt: user.disabledAt })
      .from(user)
      .where(eq(user.id, row.authorId))
      .limit(1)

    if (isPrivate) {
      c.header("Cache-Control", "no-store")
    }

    if (author?.disabledAt && !isOwner && !isAdmin) {
      return c.json({ error: "Not found" }, 404)
    }
    if (isPrivate && !isOwner && !isAdmin) {
      return c.json({ error: "Not found" }, 404)
    }
    if (row.status !== "ready" && !isOwner && !isAdmin) {
      return c.json({ error: "Not found" }, 404)
    }
    return c.json(row)
  })

  .route("/", clipsUploadRoutes)
  .route("/", clipsEngagementRoutes)
  .route("/", clipsPlaybackRoutes)
  .route("/", clipCommentsRoutes)
