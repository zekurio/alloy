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
 * is far richer than an OpenGraph unfurl.
 *
 * It does not fetch the `application/activity+json` href in the clip head.
 * That href is matched against Mastodon's canonical ActivityPub object shape
 * (`/users/{user}/statuses/{id}`) purely to recognise a fediverse post; Discord
 * then derives this REST path from the host and id and requests it. So the
 * advertised path and the served path are deliberately different, and the
 * advertised one must keep the `/users/.../statuses/...` shape.
 *
 * The id segment is the clip uuid encoded as digits — see `status-id.ts`.
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
