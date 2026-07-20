import { env } from "@alloy/server/env"
import { notFound } from "@alloy/server/runtime/http-response"
import {
  clipDetailLine,
  clipSocialDescription,
  visiblePublicClip,
} from "@alloy/server/web-clip-head"
import { Hono } from "hono"
import { z } from "zod"

import { zValidator } from "./validation"

const OEmbedQuery = z.object({
  clip: z.uuid(),
  v: z.literal("2").optional(),
})

/**
 * Minimal oEmbed endpoint for clip link unfurls, referenced by the clip
 * page's `application/json+oembed` link. The deliberately unusual field
 * placement mirrors FxEmbed's Discord video workaround. Public data only:
 * the clip must pass the same visibility rules as the social head tags.
 */
export const oembedRoute = new Hono().get(
  "/",
  zValidator("query", OEmbedQuery),
  async (c) => {
    const row = await visiblePublicClip(c.req.valid("query").clip)
    if (!row) return notFound(c)

    const origin = env.PUBLIC_SERVER_URL.replace(/\/+$/, "")
    const clipUrl = `${origin}/clips/${row.id}`
    const detailLine = clipDetailLine(row)
    const description = clipSocialDescription(row)
    const authorName =
      description.length > 255 ? `${description.slice(0, 252)}...` : description
    c.header("Cache-Control", "public, max-age=300")
    return c.json({
      version: "1.0",
      // Discord combines these values with OpenGraph rather than following the
      // oEmbed field names literally. Match FxEmbed's video layout: author_name
      // carries the body and provider_name carries the detail line, leaving
      // og:title/apple-touch-icon for the author and og:site_name for branding.
      type: "rich",
      title: "Embed",
      author_name: authorName,
      author_url: clipUrl,
      provider_name: detailLine || "alloy",
      provider_url: detailLine ? clipUrl : origin,
    })
  },
)
