import { createHash } from "node:crypto"

import type { ClipPrivacy } from "@alloy/contracts"
import { CLIP_AUDIO_TRACKS_MAX } from "@alloy/contracts/content"
import { t } from "@alloy/contracts/schema"
import { clipAudioTrack } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { clipAssetVersion } from "@alloy/server/clips/asset-version"
import { sourceIsBroadlyDecodable } from "@alloy/server/clips/codecs"
import { selectClipRenditions } from "@alloy/server/clips/renditions"
import { db } from "@alloy/server/db/index"
import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import { notFound } from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import type { Context } from "hono"
import { stream } from "hono/streaming"

import { contentDisposition, downloadFilename, IdParam } from "./clips-helpers"
import {
  mediaCacheControl,
  streamResolved,
  streamThumbnail,
} from "./clips-playback-streams"
import { tbValidator } from "./validation"

const logger = createLogger("clips")

const AudioTrackParam = t.object({
  id: t.uuid(),
  index: t
    .string()
    .regex(/^\d$/)
    .transform(Number)
    .refine((index) => index < CLIP_AUDIO_TRACKS_MAX),
})

const RenditionParam = t.object({
  id: t.uuid(),
  name: t.string().min(1).max(64),
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
 * The clip's default playback bytes: the derived cut shadows the stored
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

/** Shared serve pipeline: resolve + range streaming. */
async function serveClipAsset(
  c: Context,
  asset: { key: string; contentType: string },
  opts: {
    cacheControl: string
    etag: string
    unavailable: string
  },
): Promise<Response> {
  const resolved = await clipStorage.resolve(asset.key)
  if (!resolved) {
    logger.error(`bytes missing under ${asset.key}`)
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

function serveVersionedClipAsset(
  c: Context,
  asset: { key: string; contentType: string },
  options: {
    privacy: ClipPrivacy
    etagPrefix: string
    unavailable: string
  },
): Promise<Response> {
  const version = clipAssetVersion(asset.key)
  return serveClipAsset(c, asset, {
    cacheControl: versionedCacheControl(
      c.req.query("v"),
      version,
      options.privacy,
    ),
    etag: `"${options.etagPrefix}-${version}"`,
    unavailable: options.unavailable,
  })
}

export const clipsPlaybackRoutes = new Hono()
  /**
   * GET /api/clips/:id/stream — progressive playback bytes. Trimmed clips
   * serve their exact cut. Untrimmed clips serve the og rendition, then the
   * top rendition, then the stored source while the ladder is unavailable.
   */
  .get("/:id/stream", tbValidator("param", IdParam), async (c) => {
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
    // The cut normally wins for privacy. Exact cuts commit their own codec
    // string and are broadly decodable H.264. When the cut's codec is
    // undecodable for this endpoint's plain-video consumers, the preferred
    // rendition (encoded with the same trim range, so nothing trimmed-away
    // leaks) serves instead, with the cut as the last resort.
    const selected =
      row.cut_key && sourceIsBroadlyDecodable(row.cut_codecs)
        ? cutOrSourceAsset(row)
        : preferred
          ? { key: preferred.storage_key, contentType: "video/mp4" }
          : cutOrSourceAsset(row)

    if (!selected) {
      return notFound(c, "Stream unavailable")
    }

    return serveVersionedClipAsset(c, selected, {
      privacy: row.privacy,
      etagPrefix: "src",
      unavailable: "Stream unavailable",
    })
  })
  /**
   * GET /api/clips/:id/source/file — the default playback tier. Trimmed clips
   * serve their exact cut so trimmed-away footage stays unexposed.
   */
  .get("/:id/source/file", tbValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({ id, c, policy: "stream" })
    if (!access.accessible) return clipAccessResponse(c, access)
    const row = access.row

    const selected = cutOrSourceAsset(row)
    if (!selected) return notFound(c, "Source unavailable")

    return serveVersionedClipAsset(c, selected, {
      privacy: row.privacy,
      etagPrefix: "src",
      unavailable: "Source unavailable",
    })
  })
  /**
   * GET /api/clips/:id/original/file — the uncut stored source for the owner
   * trim editor. Re-trims must be able to expand a previous virtual trim.
   */
  .get("/:id/original/file", tbValidator("param", IdParam), async (c) => {
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
        etag: `"orig-${clipAssetVersion(row.source_key)}"`,
        unavailable: "Source unavailable",
      },
    )
  })
  /**
   * GET /api/clips/:id/rendition/:name/file.mp4 — the tier's progressive
   * MP4, served via range requests for playback and quality selection.
   */
  .get(
    "/:id/rendition/:name/file.mp4",
    tbValidator("param", RenditionParam),
    async (c) => {
      const { id, name } = c.req.valid("param")
      const access = await resolveClipAccess({ id, c, policy: "stream" })
      if (!access.accessible) return clipAccessResponse(c, access)
      const row = access.row

      const rendition = (await selectClipRenditions(id)).find(
        (candidate) => candidate.name === name,
      )
      if (!rendition) return notFound(c, "Rendition unavailable")

      return serveVersionedClipAsset(
        c,
        { key: rendition.storage_key, contentType: "video/mp4" },
        {
          privacy: row.privacy,
          etagPrefix: "rnd",
          unavailable: "Rendition unavailable",
        },
      )
    },
  )
  /**
   * GET /api/clips/:id/audio/:index/file.m4a — one isolated source stem,
   * with the same access, range, validator, and versioned-cache behavior as a
   * rendition file.
   */
  .get(
    "/:id/audio/:index/file.m4a",
    tbValidator("param", AudioTrackParam),
    async (c) => {
      const { id, index } = c.req.valid("param")
      const access = await resolveClipAccess({ id, c, policy: "stream" })
      if (!access.accessible) return clipAccessResponse(c, access)

      const [audioTrack] = await db
        .select({ storageKey: clipAudioTrack.storage_key })
        .from(clipAudioTrack)
        .where(
          and(eq(clipAudioTrack.clip_id, id), eq(clipAudioTrack.idx, index)),
        )
        .limit(1)
      if (!audioTrack) return notFound(c, "Audio track unavailable")

      return serveVersionedClipAsset(
        c,
        { key: audioTrack.storageKey, contentType: "audio/mp4" },
        {
          privacy: access.row.privacy,
          etagPrefix: `aud-${index}`,
          unavailable: "Audio track unavailable",
        },
      )
    },
  )
  /**
   * GET /api/clips/:id/thumbnail — poster image for the player and
   * queue/grid cards. Returns 404 when the media pipeline could not extract a
   * usable non-uniform poster frame; the UI falls back to a placeholder.
   */
  .get("/:id/thumbnail", tbValidator("param", IdParam), async (c) => {
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
  .get("/:id/download", tbValidator("param", IdParam), async (c) => {
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
