import { createHash } from "node:crypto"

import type { ClipPrivacy } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import {
  DIRECT_HLS_MASTER,
  directHlsContentType,
  isServableDirectHlsFile,
  makeDirectHlsSpec,
  readDirectHlsFile,
} from "@alloy/server/clips/direct-hls"
import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import { notFound } from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import { clipStorage } from "@alloy/server/storage/index"
import { type Context, Hono } from "hono"
import { stream } from "hono/streaming"

import {
  contentDisposition,
  downloadFilename,
  HlsFileParam,
  IdParam,
  StreamQuery,
} from "./clips-helpers"
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

function hlsCacheControl(privacy: ClipPrivacy): string {
  return privacy === "public"
    ? "public, max-age=300"
    : mediaCacheControl(privacy)
}

function thumbnailEtag(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 32)
  return `"thumb1-${hash}"`
}

type HlsClipRow = {
  id: string
  source_key: string | null
  source_size_bytes: number | null
  updated_at: Date | string
  privacy: ClipPrivacy
}

async function serveDirectHlsFile(
  c: Context,
  row: HlsClipRow,
  filename: string,
): Promise<Response> {
  if (!row.source_key || !isServableDirectHlsFile(filename)) {
    return notFound(c, "Adaptive stream unavailable")
  }
  const spec = makeDirectHlsSpec({
    id: row.id,
    sourceKey: row.source_key,
    sourceSizeBytes: row.source_size_bytes,
    updatedAt: row.updated_at,
  })
  const etag = `"dhls1-${spec.cacheKey}"`
  c.header("ETag", etag)
  c.header("Cache-Control", hlsCacheControl(row.privacy))
  if (ifNoneMatchSatisfied(c.req.header("if-none-match"), etag)) {
    return c.body(null, 304)
  }

  try {
    const file = await readDirectHlsFile(spec, filename)
    c.header("Content-Type", directHlsContentType(filename))
    c.header("Content-Length", String(file.size))
    c.header("Accept-Ranges", "none")
    if (c.req.method === "HEAD") return c.body(null)
    return stream(c, async (s) => {
      await pipeReadable(s, file.body)
    })
  } catch (err) {
    if (c.req.raw.signal.aborted) throw err
    logger.error(`failed to serve direct HLS file ${row.id}/${filename}:`, err)
    return notFound(c, "Adaptive stream unavailable")
  }
}

export const clipsPlaybackRoutes = new Hono()
  .get("/:id/hls/master.m3u8", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      c,
      policy: "stream",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    return serveDirectHlsFile(c, access.row, DIRECT_HLS_MASTER)
  })
  .get("/:id/hls/:file", zValidator("param", HlsFileParam), async (c) => {
    const { id, file } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      c,
      policy: "stream",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    return serveDirectHlsFile(c, access.row, file)
  })
  .get(
    "/:id/stream",
    zValidator("param", IdParam),
    zValidator("query", StreamQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant } = c.req.valid("query")
      const access = await resolveClipAccess({
        id,
        c,
        policy: "stream",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      const row = access.row

      const wantsSource =
        !requestedVariant ||
        requestedVariant === "auto" ||
        requestedVariant === "source"
      const selected =
        wantsSource && row.source_key && row.source_content_type
          ? {
              key: row.source_key,
              contentType: row.source_content_type,
              id: "source",
            }
          : null

      if (!selected) {
        return notFound(c, "Unknown quality")
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
        logger.error(`bytes missing for ready clip ${id} (${selected.id})`)
        return notFound(c, "Stream unavailable")
      }

      return streamResolved(
        c,
        resolved,
        selected.contentType || resolved.contentType,
        cacheControl,
      )
    },
  )
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
      clipStorage,
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
