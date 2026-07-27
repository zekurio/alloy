import { userDisplayLabel } from "@alloy/contracts"
import { selectEmbeddableClip } from "@alloy/server/clips/access"
import { clipIdFromPermalink } from "@alloy/server/clips/permalink"
import { env } from "@alloy/server/env"
import { badRequest, notFound } from "@alloy/server/runtime/http-response"
import { Hono } from "hono"
import { z } from "zod"

import { zValidator } from "./validation"

/**
 * oEmbed document for a clip.
 *
 * This is what puts the bold author line above the title in a Discord unfurl —
 * the slot YouTube fills with the channel name. OpenGraph has no equivalent, so
 * without this the embed jumps straight from the site name to the title.
 *
 * Deliberately `type: "link"` with no `html`: returning `type: "video"` with an
 * iframe would make Discord embed the iframe instead of the native `og:video`
 * mp4, which plays inline and is the better experience for short clips.
 */
const OembedQuery = z.object({
  url: z.string().min(1),
  format: z.enum(["json"]).optional(),
  maxwidth: z.coerce.number().int().positive().optional(),
  maxheight: z.coerce.number().int().positive().optional(),
})

export const oembedRoute = new Hono().get(
  "/",
  zValidator("query", OembedQuery),
  async (c) => {
    const clipId = clipIdFromPermalink(
      c.req.valid("query").url,
      env.PUBLIC_SERVER_URL,
    )
    if (!clipId) return badRequest(c, "Unsupported url")

    const row = await selectEmbeddableClip(clipId)
    if (!row) return notFound(c)

    const origin = env.PUBLIC_SERVER_URL
    c.header("Cache-Control", "public, max-age=300")
    return c.json({
      type: "link",
      version: "1.0",
      title: row.title,
      provider_name: "alloy",
      provider_url: origin,
      author_name: userDisplayLabel({
        username: row.authorUsername,
        displayName: row.authorDisplayName,
      }),
      author_url: new URL(
        `/u/${encodeURIComponent(row.authorUsername)}`,
        origin,
      ).toString(),
    })
  },
)
