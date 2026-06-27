import { createHash } from "node:crypto"

import { createLogger } from "@alloy/logging"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import { notFound } from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { Hono } from "hono"
import { stream } from "hono/streaming"

import { contentDisposition, downloadFilename, IdParam } from "./clips-helpers"
import {
  mediaCacheControl,
  streamResolved,
  streamThumbnail,
} from "./clips-playback-streams"
import {
  DIRECT_MEDIA_REDIRECT_MAX_AGE_SEC,
  redirectToStorageUrl,
} from "./media-redirect"
import { zValidator } from "./validation"

const logger = createLogger("clips")

function thumbnailEtag(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 32)
  return `"thumb1-${hash}"`
}

export const clipsPlaybackRoutes = new Hono()
  .get("/:id/stream", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      c,
      policy: "stream",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    const row = access.row

    const selected =
      row.source_key && row.source_content_type
        ? {
            key: row.source_key,
            contentType: row.source_content_type,
          }
        : null

    if (!selected) {
      return notFound(c, "Stream unavailable")
    }

    const cacheControl = mediaCacheControl(row.privacy)

    const direct = await redirectToStorageUrl(
      c,
      clipStorage,
      {
        key: selected.key,
        contentType: selected.contentType || undefined,
      },
      cacheControl,
    )
    if (direct) return direct

    const resolved = await clipStorage.resolve(selected.key)
    if (!resolved) {
      logger.error(`bytes missing for ready clip ${id}`)
      return notFound(c, "Stream unavailable")
    }

    return streamResolved(
      c,
      resolved,
      selected.contentType || resolved.contentType,
      cacheControl,
    )
  })
  /**
   * GET /api/clips/:id/thumbnail — poster image for the player and
   * queue/grid cards. Returns 404 when the desktop client didn't ship
   * one (intentional — the UI falls back to a gradient placeholder,
   * which it does for unencoded clips too).
   */
  .get("/:id/thumbnail", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const access = await resolveClipAccess({
      id,
      c,
      policy: "ownerAsset",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    const row = access.row

    const key = row.thumb_key
    if (!key) return notFound(c, "No thumbnail")

    const thumbCacheControl =
      row.privacy === "public" && row.status === "ready"
        ? "public, max-age=86400"
        : "private, max-age=86400"

    // Redirect responses cache for less than the signed URL lives; the
    // 24h proxy caching (and its constant ETag) would keep serving a
    // Location whose signature has expired.
    const directCacheControl =
      row.privacy === "public" && row.status === "ready"
        ? `public, max-age=${DIRECT_MEDIA_REDIRECT_MAX_AGE_SEC}`
        : `private, max-age=${DIRECT_MEDIA_REDIRECT_MAX_AGE_SEC}`
    const direct = await redirectToStorageUrl(
      c,
      clipThumbnailStorage,
      { key },
      directCacheControl,
    )
    if (direct) return direct

    const etag = thumbnailEtag(key)
    c.header("ETag", etag)
    c.header("Cache-Control", thumbCacheControl)
    if (ifNoneMatchSatisfied(c.req.header("if-none-match"), etag)) {
      return c.body(null, 304)
    }

    return await streamThumbnail(c, key, thumbCacheControl)
  })
  .get("/:id/download", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const access = await resolveClipAccess({
      id,
      c,
      policy: "ownerAsset",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    const row = access.row

    const selected =
      row.source_key && row.source_content_type
        ? {
            key: row.source_key,
            contentType: row.source_content_type,
            filename: downloadFilename(row),
          }
        : null

    if (!selected) {
      return notFound(c, "Unknown download")
    }

    const dlCacheControl =
      row.privacy === "public" ? "public, max-age=300" : "private, max-age=300"

    const direct = await redirectToStorageUrl(
      c,
      clipStorage,
      {
        key: selected.key,
        contentType: selected.contentType || undefined,
        contentDisposition: contentDisposition(selected.filename),
      },
      dlCacheControl,
    )
    if (direct) return direct

    const resolved = await clipStorage.resolve(selected.key)
    if (!resolved) {
      return notFound(c, "Download unavailable")
    }

    c.header("Content-Type", selected.contentType || resolved.contentType)
    c.header("Content-Length", String(resolved.size))
    c.header("Content-Disposition", contentDisposition(selected.filename))
    c.header("Cache-Control", dlCacheControl)
    if (c.req.method === "HEAD") return c.body(null)

    const body = resolved.stream()
    return stream(c, async (s) => {
      await pipeReadable(s, body)
    })
  })
