import { t } from "@alloy/contracts/schema"
import { selectEmbeddableClip } from "@alloy/server/clips/access"
import { clipIdFromPermalink } from "@alloy/server/clips/permalink"
import { env } from "@alloy/server/env"
import { badRequest, notFound } from "@alloy/server/runtime/http-response"
import { Hono } from "hono"

import { tbValidator } from "./validation"

// A link-only preview with a clickable Alloy provider, without author or media.
const OembedQuery = t.object({
  url: t.string().min(1),
  format: t.enum(["json"]).optional(),
  maxwidth: t.coerce.number().int().positive().optional(),
  maxheight: t.coerce.number().int().positive().optional(),
})

export const oembedRoute = new Hono().get(
  "/",
  tbValidator("query", OembedQuery),
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
      provider_url: new URL("/", origin).toString(),
    })
  },
)
