import { selectEmbeddableClip } from "@alloy/server/clips/access"
import { clipStatusDocument } from "@alloy/server/clips/status-document"
import { decodeClipStatusId } from "@alloy/server/clips/status-id"
import { env } from "@alloy/server/env"
import { clipGameName } from "@alloy/server/games/ref"
import { notFound } from "@alloy/server/runtime/http-response"
import { Hono } from "hono"

/**
 * Mastodon-compatible status document for a clip.
 *
 * Discord renders fediverse posts with a dedicated layout — author avatar,
 * `display name (@handle)`, body text, inline player, instance footer — which
 * is far richer than an OpenGraph unfurl. It reaches this route by following
 * the `application/activity+json` alternate link in the clip head, parsing the
 * host as a Mastodon instance and calling the standard REST path itself.
 *
 * The path segment is the clip uuid encoded as digits, because that layout is
 * only used when the status id looks like a Mastodon id. See `status-id.ts`.
 */
export const activityRoute = new Hono().get("/statuses/:id", async (c) => {
  const clipId = decodeClipStatusId(c.req.param("id"))
  if (!clipId) return notFound(c)

  const row = await selectEmbeddableClip(clipId)
  if (!row) return notFound(c)

  const document = clipStatusDocument(
    {
      ...row,
      gameName: clipGameName(row),
      author: {
        id: row.authorId,
        username: row.authorUsername,
        displayName: row.authorDisplayName,
        image: row.authorImage,
        banner: row.author.banner,
        createdAt: row.author.createdAt,
        updatedAt: row.author.updatedAt,
      },
    },
    { origin: env.PUBLIC_SERVER_URL, siteName: "alloy" },
  )
  if (!document) return notFound(c)

  // Public, shareable content: opt out of the private no-store default applied
  // to every other /api/* response.
  c.header("Cache-Control", "public, max-age=300")
  return c.json(document)
})
