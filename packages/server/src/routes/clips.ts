import { user } from "@alloy/db/auth-schema"
import { clip, game } from "@alloy/db/schema"
import {
  applyClipPrivacyHeaders,
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import {
  clipSelectShape,
  selectClipById,
  toPublicClipRow,
} from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { invalidCursor, notFound } from "@alloy/server/runtime/http-response"
import { and, eq, gte, isNull, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { clipCommentsRoutes } from "./clip-comments"
import { clipsEngagementRoutes } from "./clips-engagement"
import {
  clipListCursorCondition,
  clipListOrderBy,
  clipListPage,
  IdParam,
  ListQuery,
  parseClipListCursor,
  publicClipPrivacyCondition,
  WINDOW_MS,
} from "./clips-helpers"
import { clipsPlaybackRoutes } from "./clips-playback"
import { clipsUploadRoutes } from "./clips-upload"
import { zValidator } from "./validation"

export const clips = new Hono()
  .get("/", zValidator("query", ListQuery), async (c) => {
    const { window, sort, cursor, limit } = c.req.valid("query")
    const parsedCursor = parseClipListCursor(cursor, sort)
    if (cursor && !parsedCursor) {
      return invalidCursor(c)
    }

    const conditions: SQL[] = [
      eq(clip.status, "ready"),
      publicClipPrivacyCondition(),
      isNull(user.disabledAt),
    ]
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
      .innerJoin(game, eq(clip.steamgriddbId, game.steamgriddbId))
      .where(and(...conditions))
      .orderBy(...clipListOrderBy(sort))
      .limit(limit + 1)

    return c.json(clipListPage(rows, limit, sort))
  })
  .get("/:id", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "metadata",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    applyClipPrivacyHeaders(c, access)

    const row = await selectClipById(id)
    if (!row) return notFound(c)
    return c.json(toPublicClipRow(row))
  })
  .route("/", clipsUploadRoutes)
  .route("/", clipsEngagementRoutes)
  .route("/", clipsPlaybackRoutes)
  .route("/", clipCommentsRoutes)
