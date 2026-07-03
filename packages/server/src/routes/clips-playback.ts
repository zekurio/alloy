import { createHash } from "node:crypto"

import type { ClipPrivacy } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { clipAssetVersion } from "@alloy/server/clips/asset-version"
import { selectClipRenditions } from "@alloy/server/clips/renditions"
import { playbackVersionFromKeys } from "@alloy/server/clips/select"
import {
  renderMasterPlaylist,
  renderMediaPlaylist,
} from "@alloy/server/media/renditions"
import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import { notFound } from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { z } from "zod"

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

const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl"

const RenditionParam = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(64),
})

/**
 * Find a committed rendition by name. Legacy URLs used the bare height
 * (`/rendition/1080/...`), so an all-digit param falls back to the derived
 * `${height}p` name and then to a plain height match.
 */
function findRenditionByName<T extends { name: string; height: number }>(
  renditions: readonly T[],
  param: string,
): T | undefined {
  const byName = renditions.find((candidate) => candidate.name === param)
  if (byName) return byName
  if (!/^\d+$/.test(param)) return undefined
  return (
    renditions.find((candidate) => candidate.name === `${param}p`) ??
    renditions.find((candidate) => candidate.height === Number(param))
  )
}

function thumbnailEtag(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 32)
  return `"thumb1-${hash}"`
}

/** Immutable when the request names the current version, short TTL otherwise. */
function versionedCacheControl(
  requestedVersion: string | undefined,
  version: string,
  privacy: ClipPrivacy,
): string {
  if (requestedVersion === version) {
    return `${privacy === "public" ? "public" : "private"}, max-age=31536000, immutable`
  }
  return mediaCacheControl(privacy)
}

export const clipsPlaybackRoutes = new Hono()
  /**
   * GET /api/clips/:id/stream — progressive playback bytes. Serves the og
   * rendition (H.264+AAC, so OpenGraph embeds, plain <video> tags, and the
   * player's HLS-failure fallback decode everywhere), then the top rendition
   * for ladders without one, then the stored source for clips the rendition
   * backfill hasn't reached yet.
   */
  .get("/:id/stream", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      c,
      policy: "stream",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    const row = access.row

    const renditions = await selectClipRenditions(id)
    const preferred =
      renditions.find((rendition) => rendition.is_og) ?? renditions[0]
    const selected = preferred
      ? { key: preferred.storage_key, contentType: "video/mp4" }
      : row.source_key && row.source_content_type
        ? {
            key: row.source_key,
            contentType: row.source_content_type,
          }
        : null

    if (!selected) {
      return notFound(c, "Stream unavailable")
    }

    const version = clipAssetVersion(selected.key)
    const etag = `"src-${version}"`
    // Published bytes are immutable under run-scoped keys, so a request
    // naming the current version can cache forever while unversioned requests
    // keep the short TTL so a republish propagates.
    const cacheControl = versionedCacheControl(
      c.req.query("v"),
      version,
      row.privacy,
    )

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
      { etag },
    )
  })
  /**
   * GET /api/clips/:id/master.m3u8 — HLS master playlist over the committed
   * renditions. Variant URIs are relative, so they resolve under the same
   * /api/clips/:id/ prefix (and the same auth) regardless of origin.
   */
  .get("/:id/master.m3u8", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({ id, c, policy: "stream" })
    if (!access.accessible) return clipAccessResponse(c, access)
    const row = access.row

    const renditions = await selectClipRenditions(id)
    if (renditions.length === 0) return notFound(c, "Playlist unavailable")

    const version = playbackVersionFromKeys(
      renditions.map((rendition) => rendition.storage_key),
    )
    const body = renderMasterPlaylist(
      renditions.map((rendition) => ({
        height: rendition.height,
        width: rendition.width,
        fps: rendition.fps,
        codecs: rendition.codecs,
        bandwidth: rendition.bandwidth,
        playlistUrl: `rendition/${rendition.name}/index.m3u8?v=${clipAssetVersion(rendition.storage_key)}`,
      })),
    )
    c.header("Content-Type", HLS_CONTENT_TYPE)
    c.header(
      "Cache-Control",
      versionedCacheControl(c.req.query("v"), version ?? "", row.privacy),
    )
    if (c.req.method === "HEAD") return c.body(null)
    return c.body(body)
  })
  /**
   * GET /api/clips/:id/rendition/:name/index.m3u8 — one tier's media
   * playlist. Stored with a placeholder URI; the versioned file URL is
   * substituted here so stored playlists never embed origins or keys.
   */
  .get(
    "/:id/rendition/:name/index.m3u8",
    zValidator("param", RenditionParam),
    async (c) => {
      const { id, name } = c.req.valid("param")
      const access = await resolveClipAccess({ id, c, policy: "stream" })
      if (!access.accessible) return clipAccessResponse(c, access)
      const row = access.row

      const rendition = findRenditionByName(
        await selectClipRenditions(id),
        name,
      )
      if (!rendition) return notFound(c, "Playlist unavailable")

      const version = clipAssetVersion(rendition.storage_key)
      const body = renderMediaPlaylist(
        rendition.playlist,
        `file.mp4?v=${version}`,
      )
      c.header("Content-Type", HLS_CONTENT_TYPE)
      c.header(
        "Cache-Control",
        versionedCacheControl(c.req.query("v"), version, row.privacy),
      )
      if (c.req.method === "HEAD") return c.body(null)
      return c.body(body)
    },
  )
  /**
   * GET /api/clips/:id/rendition/:name/file.mp4 — the tier's single-file
   * fMP4. Serves both HLS byte-range segment reads and plain progressive
   * playback (quality selection on players without MSE).
   */
  .get(
    "/:id/rendition/:name/file.mp4",
    zValidator("param", RenditionParam),
    async (c) => {
      const { id, name } = c.req.valid("param")
      const access = await resolveClipAccess({ id, c, policy: "stream" })
      if (!access.accessible) return clipAccessResponse(c, access)
      const row = access.row

      const rendition = findRenditionByName(
        await selectClipRenditions(id),
        name,
      )
      if (!rendition) return notFound(c, "Rendition unavailable")

      const version = clipAssetVersion(rendition.storage_key)
      const cacheControl = versionedCacheControl(
        c.req.query("v"),
        version,
        row.privacy,
      )

      const direct = await redirectToStorageUrl(
        c,
        clipStorage,
        { key: rendition.storage_key, contentType: "video/mp4" },
        cacheControl,
      )
      if (direct) return direct

      const resolved = await clipStorage.resolve(rendition.storage_key)
      if (!resolved) {
        logger.error(`rendition bytes missing for clip ${id} ${name}`)
        return notFound(c, "Rendition unavailable")
      }

      return streamResolved(c, resolved, "video/mp4", cacheControl, {
        etag: `"rnd-${version}"`,
      })
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

    return await streamThumbnail(
      c,
      clipThumbnailStorage,
      key,
      thumbCacheControl,
    )
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
