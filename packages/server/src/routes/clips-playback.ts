import { createHash } from "node:crypto"

import type { ClipPrivacy } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { clipAssetVersion } from "@alloy/server/clips/asset-version"
import {
  renditionIsH264,
  sourceIsBroadlyDecodable,
} from "@alloy/server/clips/codecs"
import { selectClipRenditions } from "@alloy/server/clips/renditions"
import {
  clipScrubberKey,
  ensureClipScrubberSheet,
} from "@alloy/server/clips/scrubber"
import { enqueueClipVerify } from "@alloy/server/jobs/kinds/storage-verify"
import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import { notFound } from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { Hono } from "hono"
import type { Context } from "hono"
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

const RenditionParam = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(64),
})

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

/**
 * The clip's default playback bytes: the stream-copy cut shadows the stored
 * source so trimmed-away footage never serves from a public endpoint.
 */
function cutOrSourceAsset(row: {
  cut_key: string | null
  source_key: string | null
  source_content_type: string | null
}): { key: string; contentType: string } | null {
  if (row.cut_key) return { key: row.cut_key, contentType: "video/mp4" }
  if (row.source_key && row.source_content_type) {
    return { key: row.source_key, contentType: row.source_content_type }
  }
  return null
}

/** Shared serve pipeline: storage redirect, else resolve + range streaming. */
async function serveClipAsset(
  c: Context,
  asset: { key: string; contentType: string },
  opts: {
    cacheControl: string
    clipId: string
    etag: string
    unavailable: string
  },
): Promise<Response> {
  const direct = await redirectToStorageUrl(
    c,
    clipStorage,
    { key: asset.key, contentType: asset.contentType || undefined },
    opts.cacheControl,
  )
  if (direct) return direct

  const resolved = await clipStorage.resolve(asset.key)
  if (!resolved) {
    logger.error(`bytes missing under ${asset.key}`)
    void enqueueClipVerify(opts.clipId).catch((err) => {
      logger.warn(
        `failed to enqueue storage verification for ${opts.clipId}:`,
        err,
      )
    })
    return notFound(c, opts.unavailable)
  }

  return streamResolved(
    c,
    resolved,
    asset.contentType || resolved.contentType,
    opts.cacheControl,
    { etag: opts.etag },
  )
}

export const clipsPlaybackRoutes = new Hono()
  /**
   * GET /api/clips/:id/stream — progressive playback bytes. Trimmed clips
   * serve their stream-copy cut. Untrimmed clips serve the og rendition, then
   * the top rendition, then the stored source while the ladder is unavailable.
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
    const h264 =
      renditions.find(
        (rendition) => rendition.is_og && renditionIsH264(rendition.codecs),
      ) ??
      renditions.find((rendition) => renditionIsH264(rendition.codecs)) ??
      null
    // The cut normally wins for privacy. HEVC/AV1 cuts are undecodable for
    // this endpoint's plain-video consumers, and the H.264 tier is encoded
    // from the cut so nothing trimmed-away leaks.
    const selected = row.cut_key
      ? sourceIsBroadlyDecodable(row.source_codecs)
        ? cutOrSourceAsset(row)
        : h264
          ? { key: h264.storage_key, contentType: "video/mp4" }
          : cutOrSourceAsset(row)
      : preferred
        ? { key: preferred.storage_key, contentType: "video/mp4" }
        : cutOrSourceAsset(row)

    if (!selected) {
      return notFound(c, "Stream unavailable")
    }

    const version = clipAssetVersion(selected.key)
    // Published bytes are immutable under run-scoped keys, so a request
    // naming the current version can cache forever while unversioned requests
    // keep the short TTL so a republish propagates.
    return serveClipAsset(c, selected, {
      cacheControl: versionedCacheControl(
        c.req.query("v"),
        version,
        row.privacy,
      ),
      clipId: id,
      etag: `"src-${version}"`,
      unavailable: "Stream unavailable",
    })
  })
  /**
   * GET /api/clips/:id/source/file — the default playback tier. Trimmed clips
   * serve their stream-copy cut so trimmed-away footage stays unexposed.
   */
  .get("/:id/source/file", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({ id, c, policy: "stream" })
    if (!access.accessible) return clipAccessResponse(c, access)
    const row = access.row

    const selected = cutOrSourceAsset(row)
    if (!selected) return notFound(c, "Source unavailable")

    const version = clipAssetVersion(selected.key)
    return serveClipAsset(c, selected, {
      cacheControl: versionedCacheControl(
        c.req.query("v"),
        version,
        row.privacy,
      ),
      clipId: id,
      etag: `"src-${version}"`,
      unavailable: "Source unavailable",
    })
  })
  /**
   * GET /api/clips/:id/original/file — the uncut stored source for the owner
   * trim editor. Re-trims must be able to expand a previous virtual trim.
   */
  .get("/:id/original/file", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({ id, c, policy: "ownerAsset" })
    if (!access.accessible) return clipAccessResponse(c, access)
    if (!access.isOwner && !access.isAdmin) return notFound(c, "Not found")
    const row = access.row

    if (!row.source_key || !row.source_content_type) {
      return notFound(c, "Source unavailable")
    }

    return serveClipAsset(
      c,
      { key: row.source_key, contentType: row.source_content_type },
      {
        cacheControl: "private, max-age=300",
        clipId: id,
        etag: `"orig-${clipAssetVersion(row.source_key)}"`,
        unavailable: "Source unavailable",
      },
    )
  })
  /**
   * GET /api/clips/:id/scrubber/file — trim-scrubber sprite sheet for the
   * owner editor, derived lazily from the uncut stored source and cached
   * under a deterministic key.
   */
  .get("/:id/scrubber/file", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({ id, c, policy: "ownerAsset" })
    if (!access.accessible) return clipAccessResponse(c, access)
    if (!access.isOwner && !access.isAdmin) return notFound(c, "Not found")
    const row = access.row

    const durationMs = row.source_duration_ms ?? row.duration_ms
    if (!row.source_key || durationMs == null || durationMs <= 0) {
      return notFound(c, "Scrubber unavailable")
    }

    // The sheet derives from the immutable source, so the source version
    // makes a stable validator for the lifetime of the clip — check it
    // before touching storage so revalidations stay free.
    const etag = `"scrub-${clipAssetVersion(row.source_key)}"`
    const cacheControl = "private, max-age=86400"
    c.header("ETag", etag)
    if (ifNoneMatchSatisfied(c.req.header("if-none-match"), etag)) {
      c.header("Cache-Control", cacheControl)
      return c.body(null, 304)
    }

    const exists = await ensureClipScrubberSheet({
      clipId: id,
      sourceKey: row.source_key,
      durationMs,
    })
    if (!exists) return notFound(c, "Scrubber unavailable")

    return await streamThumbnail(
      c,
      clipThumbnailStorage,
      clipScrubberKey(id),
      cacheControl,
    )
  })
  /**
   * GET /api/clips/:id/rendition/:name/file.mp4 — the tier's progressive
   * MP4, served via range requests for playback and quality selection.
   */
  .get(
    "/:id/rendition/:name/file.mp4",
    zValidator("param", RenditionParam),
    async (c) => {
      const { id, name } = c.req.valid("param")
      const access = await resolveClipAccess({ id, c, policy: "stream" })
      if (!access.accessible) return clipAccessResponse(c, access)
      const row = access.row

      const rendition = (await selectClipRenditions(id)).find(
        (candidate) => candidate.name === name,
      )
      if (!rendition) return notFound(c, "Rendition unavailable")

      const version = clipAssetVersion(rendition.storage_key)
      return serveClipAsset(
        c,
        { key: rendition.storage_key, contentType: "video/mp4" },
        {
          cacheControl: versionedCacheControl(
            c.req.query("v"),
            version,
            row.privacy,
          ),
          clipId: id,
          etag: `"rnd-${version}"`,
          unavailable: "Rendition unavailable",
        },
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

    const asset = cutOrSourceAsset(row)
    if (!asset) {
      return notFound(c, "Unknown download")
    }
    const selected = { ...asset, filename: downloadFilename(row) }

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
