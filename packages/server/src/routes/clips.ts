import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { selectClipById, toPublicClipRow } from "@alloy/server/clips/select"
import { notFound } from "@alloy/server/runtime/http-response"
import { Hono } from "hono"

import { clipCommentsRoutes } from "./clip-comments"
import { clipsEngagementRoutes } from "./clips-engagement"
import { IdParam } from "./clips-helpers"
import { clipsPlaybackRoutes } from "./clips-playback"
import { clipsUploadRoutes } from "./clips-upload"
import { zValidator } from "./validation"

export const clips = new Hono()
  .get("/:id", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "metadata",
    })
    if (!access.accessible) return clipAccessResponse(c, access)

    const row = await selectClipById(id)
    if (!row) return notFound(c)
    return c.json(toPublicClipRow(row))
  })
  .route("/", clipsUploadRoutes)
  .route("/", clipsEngagementRoutes)
  .route("/", clipsPlaybackRoutes)
  .route("/", clipCommentsRoutes)
