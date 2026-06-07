import { logger } from "alloy-logging"
import { Hono } from "hono"
import { stream } from "hono/streaming"

import {
  applyClipPrivacyHeaders,
  clipAccessResponse,
  resolveClipAccess,
} from "../clips/access"
import {
  buildLiveHlsMediaPlaylist,
  liveHlsSegmentCount,
  parseLiveHlsSegment,
  readLiveHlsFile,
} from "../clips/live-hls-cache"
import {
  buildPlaybackQualities,
  findPlaybackQuality,
} from "../clips/playback-quality"
import { configStore } from "../config/store"
import { notFound } from "../runtime/http-response"
import { pipeReadable } from "../runtime/streaming"
import { clipStorage } from "../storage"
import {
  contentDisposition,
  downloadFilename,
  DownloadQuery,
  HlsCacheParam,
  HlsSegmentQuery,
  HlsSegmentParam,
  HlsStreamQuery,
  IdParam,
  StreamQuery,
} from "./clips-helpers"
import {
  buildLiveHlsMasterPlaylist,
  findLiveHlsSpec,
  hlsCacheControl,
  liveHlsMasterStreams,
  liveHlsQuerySuffix,
  liveHlsSpecsForRow,
  ticksToSeconds,
} from "./clips-playback-hls"
import {
  mediaCacheControl,
  streamLiveQuality,
  streamOpenGraphVideo,
  streamResolved,
  streamThumbnail,
} from "./clips-playback-streams"
import { zValidator } from "./validation"

export const clipsPlaybackRoutes = new Hono()
  .get(
    "/:id/hls/master.m3u8",
    zValidator("param", IdParam),
    zValidator("query", HlsStreamQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { codecs, variant } = c.req.valid("query")
      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "stream",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)

      const specs = await liveHlsSpecsForRow(access.row, codecs, variant)
      if (specs.length === 0) return notFound(c, "Adaptive stream unavailable")

      const streams = liveHlsMasterStreams(
        specs,
        Boolean(access.row.sourceAudioCodec),
      )

      c.header("Content-Type", "application/vnd.apple.mpegurl")
      c.header("Cache-Control", hlsCacheControl(access.row.privacy))
      return c.text(buildLiveHlsMasterPlaylist(streams, codecs))
    },
  )
  .get(
    "/:id/hls/:cacheKey/stream.m3u8",
    zValidator("param", HlsCacheParam),
    zValidator("query", HlsStreamQuery),
    async (c) => {
      const { id, cacheKey } = c.req.valid("param")
      const { codecs, variant } = c.req.valid("query")
      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "stream",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)

      const row = access.row
      if (!row.durationMs) return notFound(c, "Adaptive stream unavailable")
      const spec = findLiveHlsSpec(
        await liveHlsSpecsForRow(row, codecs, variant),
        cacheKey,
      )
      if (!spec) return notFound(c, "Adaptive stream unavailable")

      c.header("Content-Type", "application/vnd.apple.mpegurl")
      c.header("Cache-Control", hlsCacheControl(row.privacy))
      return c.text(
        buildLiveHlsMediaPlaylist({
          spec,
          durationMs: row.durationMs,
          querySuffix: liveHlsQuerySuffix(codecs),
        }),
      )
    },
  )
  .get(
    "/:id/hls/:cacheKey/:segment",
    zValidator("param", HlsSegmentParam),
    zValidator("query", HlsSegmentQuery),
    async (c) => {
      const { id, cacheKey, segment } = c.req.valid("param")
      const { codecs, variant, runtimeTicks } = c.req.valid("query")
      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "stream",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)

      const row = access.row
      if (!row.durationMs) return notFound(c, "Adaptive segment unavailable")
      const parsedSegment = parseLiveHlsSegment(cacheKey, segment)
      if (!parsedSegment) return notFound(c, "Adaptive segment unavailable")
      if (
        parsedSegment.kind === "segment" &&
        parsedSegment.index >= liveHlsSegmentCount(row.durationMs)
      ) {
        return notFound(c, "Adaptive segment unavailable")
      }
      const spec = findLiveHlsSpec(
        await liveHlsSpecsForRow(row, codecs, variant),
        cacheKey,
      )
      if (!spec) return notFound(c, "Adaptive segment unavailable")

      try {
        const file = await readLiveHlsFile(
          spec,
          segment,
          row.durationMs,
          ticksToSeconds(runtimeTicks),
          c.req.raw.signal,
        )
        c.header("Content-Type", "video/mp4")
        c.header("Content-Length", String(file.size))
        c.header("Accept-Ranges", "none")
        c.header("Cache-Control", hlsCacheControl(row.privacy))
        if (c.req.method === "HEAD") return c.body(null)
        return stream(c, async (s) => {
          await pipeReadable(s, file.body)
        })
      } catch (err) {
        if (c.req.raw.signal.aborted) throw err
        logger.error(`[clips] failed to serve live HLS segment ${id}:`, err)
        return notFound(c, "Adaptive segment unavailable")
      }
    },
  )
  .get(
    "/:id/stream",
    zValidator("param", IdParam),
    zValidator("query", StreamQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant, codecs } = c.req.valid("query")
      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "stream",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)
      const row = access.row

      const liveQuality = configStore.get("encoder").enabled
        ? findPlaybackQuality(buildPlaybackQualities(row), requestedVariant)
        : null
      if (liveQuality) {
        return await streamLiveQuality(c, row, liveQuality, codecs)
      }

      const wantsSource =
        !requestedVariant ||
        requestedVariant === "auto" ||
        requestedVariant === "source"
      const selected =
        wantsSource && row.sourceKey && row.sourceContentType
          ? {
              key: row.sourceKey,
              contentType: row.sourceContentType,
              id: "source",
            }
          : null

      if (!selected) {
        return notFound(c, "Unknown quality")
      }

      const cacheControl = mediaCacheControl(row.privacy)

      const resolved = await clipStorage.resolve(selected.key)
      if (!resolved) {
        logger.error(
          `[clips] bytes missing for ready clip ${id} (${selected.id})`,
        )
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
   * queue/grid cards. Returns 404 when the encoder couldn't produce
   * one (intentional — the UI falls back to a gradient placeholder,
   * which it does for unencoded clips too).
   */
  .get("/:id/thumbnail", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const access = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "ownerAsset",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    applyClipPrivacyHeaders(c, access)
    const row = access.row

    const key = row.thumbKey
    if (!key) return notFound(c, "No thumbnail")

    const thumbCacheControl =
      row.privacy === "public" && row.status === "ready"
        ? "public, max-age=86400"
        : row.privacy === "private"
          ? "no-store"
          : "private, max-age=86400"

    return await streamThumbnail(c, key, thumbCacheControl)
  })
  .get("/:id/opengraph", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "openGraphAsset",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    return await streamOpenGraphVideo(c, access.row)
  })
  .get(
    "/:id/download",
    zValidator("param", IdParam),
    zValidator("query", DownloadQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant } = c.req.valid("query")

      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "ownerAsset",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)
      const row = access.row

      const selected =
        requestedVariant === "source"
          ? row.sourceKey && row.sourceContentType
            ? {
                key: row.sourceKey,
                contentType: row.sourceContentType,
                filename: downloadFilename(row, "source"),
              }
            : null
          : null

      if (!selected) {
        return notFound(c, "Unknown download")
      }

      const dlCacheControl =
        row.privacy === "public"
          ? "public, max-age=300"
          : row.privacy === "private"
            ? "no-store"
            : "private, max-age=300"

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
    },
  )
