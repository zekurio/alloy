import { env } from "@alloy/server/env"
import { notFound } from "@alloy/server/runtime/http-response"
import {
  clipGameName,
  visiblePublicClip,
  type MetadataClip,
} from "@alloy/server/web-clip-head"
import { Hono } from "hono"
import { z } from "zod"

import { zValidator } from "./validation"

const OEmbedQuery = z.object({
  clip: z.uuid(),
})

/**
 * Minimal oEmbed endpoint for clip link unfurls, referenced by the clip
 * page's `application/json+oembed` link. Discord maps `provider_name` to the
 * bottom branding line of the embed (superseding the og:site_name top line)
 * and renders `author_name` as an extra text line — the same slots FxTwitter
 * uses for its footer and stats. Public data only: the clip must pass the
 * same visibility rules as the social head tags.
 */
export const oembedRoute = new Hono().get(
  "/",
  zValidator("query", OEmbedQuery),
  async (c) => {
    const row = await visiblePublicClip(c.req.valid("query").clip)
    if (!row) return notFound(c)

    const origin = env.PUBLIC_SERVER_URL.replace(/\/+$/, "")
    const detailLine = clipDetailLine(row)
    c.header("Cache-Control", "public, max-age=300")
    return c.json({
      version: "1.0",
      type: "link",
      title: row.title,
      provider_name: "alloy",
      provider_url: origin,
      ...(detailLine
        ? {
            author_name: detailLine,
            author_url: `${origin}/clips/${row.id}`,
          }
        : {}),
    })
  },
)

/** "Game · duration" line; either part may be missing. */
function clipDetailLine(row: MetadataClip): string {
  // Skip the "Uncategorised" fallback: a game-less clip shows duration only.
  const hasGame = row.gameId !== null || Boolean(row.game?.trim())
  return [
    hasGame ? clipGameName(row) : null,
    row.durationMs !== null && row.durationMs > 0
      ? formatDuration(row.durationMs)
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ")
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
