import { createReadStream } from "node:fs"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { Readable } from "node:stream"

import type { ClipPlaybackQuality, ClipPrivacy } from "@workspace/contracts"
import { logger } from "@workspace/logging"
import { type Context, Hono } from "hono"
import { stream } from "hono/streaming"

import {
  applyClipPrivacyHeaders,
  clipAccessResponse,
  resolveClipAccess,
} from "../clips/access"
import { parseRequestedLiveCodecs, selectLiveCodec } from "../clips/live-codec"
import {
  buildLiveHlsMediaPlaylist,
  liveHlsCachedCodecs,
  liveHlsSegmentCount,
  makeLiveHlsSpec,
  parseLiveHlsSegment,
  readLiveHlsFile,
  type LiveHlsSpec,
} from "../clips/live-hls-cache"
import { isOpenGraphCompatibleSource } from "../clips/opengraph"
import {
  buildPlaybackQualities,
  findPlaybackQuality,
} from "../clips/playback-quality"
import { configStore } from "../config/store"
import { codecNameFor, encode, liveTranscode, probe } from "../queue/ffmpeg"
import { ENCODE_DIR } from "../runtime/dirs"
import { notFound } from "../runtime/http-response"
import { join } from "../runtime/path"
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
  parseRange,
  readAll,
  StreamQuery,
} from "./clips-helpers"
import { zValidator } from "./validation"

type LiveTranscodeClipRow = {
  id: string
  sourceKey: string | null
}

type OpenGraphClipRow = {
  id: string
  sourceKey: string | null
  sourceContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  durationMs: number | null
  height: number | null
}

type LiveHlsClipRow = LiveTranscodeClipRow & {
  sourceSizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  updatedAt: Date | string
}

/** Cache-Control for playback bytes/manifests, keyed on clip privacy. */
function mediaCacheControl(privacy: ClipPrivacy): string {
  return privacy === "public"
    ? "public, max-age=300"
    : privacy === "private"
      ? "no-store"
      : "private, max-age=300"
}

/** Stream an already-resolved object, honouring an optional `Range` request.
 *  Never redirects, so it is safe for hls.js segment fetches (same-origin). */
function streamResolved(
  c: Context,
  resolved: NonNullable<Awaited<ReturnType<typeof clipStorage.resolve>>>,
  contentType: string,
  cacheControl: string,
): Response {
  const range = parseRange(c.req.header("range"), resolved.size)
  if (range) {
    const length = range.end - range.start + 1
    const body = resolved.stream({ start: range.start, end: range.end })
    c.header("Content-Type", contentType)
    c.header(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${resolved.size}`,
    )
    c.header("Content-Length", String(length))
    c.header("Accept-Ranges", "bytes")
    c.header("Cache-Control", cacheControl)
    c.status(206)
    if (c.req.method === "HEAD") return c.body(null)
    return stream(c, async (s) => {
      await pipeReadable(s, body)
    })
  }

  const body = resolved.stream()
  c.header("Content-Type", contentType)
  c.header("Content-Length", String(resolved.size))
  c.header("Accept-Ranges", "bytes")
  c.header("Cache-Control", cacheControl)
  if (c.req.method === "HEAD") return c.body(null)
  return stream(c, async (s) => {
    await pipeReadable(s, body)
  })
}

async function liveHlsSpecsForRow(
  row: LiveHlsClipRow,
  codecQuery: string | undefined,
  variantId: string | undefined,
): Promise<LiveHlsSpec[]> {
  if (!row.sourceKey || !row.durationMs) return []
  const encoderConfig = configStore.get("encoder")
  if (!encoderConfig.enabled) return []
  const requestedCodecs = parseRequestedLiveCodecs(codecQuery)
  const selectedCodec = await selectLiveCodec(
    encoderConfig.hwaccel,
    requestedCodecs.codecs,
  )
  if (!selectedCodec) return []

  return buildPlaybackQualities(row)
    .filter((quality) => !variantId || quality.id === variantId)
    .map((quality) =>
      makeLiveHlsSpec({
        clipId: row.id,
        sourceKey: row.sourceKey as string,
        sourceSizeBytes: row.sourceSizeBytes,
        updatedAt: row.updatedAt,
        quality,
        codec: selectedCodec.codec,
        encoder: selectedCodec.encoder,
        encoderConfig,
      }),
    )
}

function findLiveHlsSpec(
  specs: readonly LiveHlsSpec[],
  cacheKey: string,
): LiveHlsSpec | null {
  return specs.find((spec) => spec.cacheKey === cacheKey) ?? null
}

type LiveHlsMasterStream = { spec: LiveHlsSpec; codecs: string }

function buildLiveHlsMasterPlaylist(
  streams: readonly LiveHlsMasterStream[],
  codecQuery: string | undefined,
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]
  const querySuffix = liveHlsQuerySuffix(codecQuery)
  for (const { spec, codecs } of streams) {
    const quality = spec.quality
    const attrs = [
      `BANDWIDTH=${quality.bitrate}`,
      `AVERAGE-BANDWIDTH=${quality.bitrate}`,
      quality.width ? `RESOLUTION=${quality.width}x${quality.height}` : null,
      `CODECS="${codecs}"`,
    ].filter((attr): attr is string => attr !== null)
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(",")}`)
    lines.push(`${spec.cacheKey}/stream.m3u8${querySuffix}`)
  }
  return `${lines.join("\n")}\n`
}

/** Pair each rendition with its CODECS for the master playlist: the exact value
 *  once the init segment has been served and cached, otherwise a conservative
 *  default. Never blocks, so a slow cold transcode (e.g. libsvtav1) can't stall
 *  the manifest. The init governs the real SourceBuffer in hls.js, so the
 *  default only needs to pass MediaSource.isTypeSupported until the cache warms. */
function liveHlsMasterStreams(
  specs: readonly LiveHlsSpec[],
  hasAudio: boolean,
): LiveHlsMasterStream[] {
  return specs.map((spec) => ({
    spec,
    codecs:
      liveHlsCachedCodecs(spec.cacheKey) ??
      hlsCodecString(spec.codec, hasAudio),
  }))
}

function hlsCodecString(codec: string, hasAudio: boolean): string {
  const video =
    codec === "av1"
      ? "av01.0.08M.08"
      : codec === "hevc"
        ? "hvc1.1.6.L120.90"
        : "avc1.42E01E"
  return hasAudio ? `${video},mp4a.40.2` : video
}

function hlsCacheControl(privacy: ClipPrivacy): string {
  return privacy === "public"
    ? "public, max-age=300"
    : mediaCacheControl(privacy)
}

function liveHlsQuerySuffix(codecQuery: string | undefined): string {
  return codecQuery ? `?codecs=${encodeURIComponent(codecQuery)}` : ""
}

function ticksToSeconds(ticks: number | undefined): number {
  return ticks === undefined ? 0 : Math.max(0, ticks / 10_000_000)
}

async function streamLiveQuality(
  c: Context,
  row: LiveTranscodeClipRow,
  quality: ClipPlaybackQuality,
  codecQuery: string | undefined,
): Promise<Response> {
  const sourceKey = row.sourceKey
  if (!sourceKey) return notFound(c, "Source unavailable")

  const encoderConfig = configStore.get("encoder")
  const requestedCodecs = parseRequestedLiveCodecs(codecQuery)
  const selectedCodec = await selectLiveCodec(
    encoderConfig.hwaccel,
    requestedCodecs.codecs,
  )
  if (!selectedCodec) {
    const message = requestedCodecs.explicitlyRequested
      ? "No mutually supported live codec"
      : "Live transcoding codec unavailable"
    return notFound(c, message)
  }

  await mkdir(ENCODE_DIR, { recursive: true })
  const scratchDir = await mkdtemp(`${ENCODE_DIR}/${row.id}-live-`)
  const sourcePath = join(scratchDir, "source")
  try {
    await clipStorage.downloadToFile(sourceKey, sourcePath)
  } catch (err) {
    await rm(scratchDir, { recursive: true, force: true }).catch(
      () => undefined,
    )
    logger.error(
      `[clips] failed to stage source for live transcode ${row.id}:`,
      err,
    )
    return notFound(c, "Source unavailable")
  }
  const sourceColor = (await probe(sourcePath)).color

  const transcode = liveTranscode(sourcePath, {
    config: {
      hwaccel: encoderConfig.hwaccel,
      encoder: selectedCodec.encoder,
      quality: 23,
      audioBitrateKbps: Math.round(quality.audioBitrate / 1000),
      extraInputArgs: "",
      extraOutputArgs: "",
      qsvDevice: encoderConfig.qsvDevice,
      vaapiDevice: encoderConfig.vaapiDevice,
      intelLowPowerH264: encoderConfig.intelLowPowerH264,
      intelLowPowerHevc: encoderConfig.intelLowPowerHevc,
      tonemapping: encoderConfig.tonemapping,
      sourceColor,
    },
    targetHeight: quality.height,
    videoBitrate: quality.videoBitrate,
    audioBitrate: quality.audioBitrate,
  })

  c.header("Content-Type", "video/mp4")
  c.header("Cache-Control", "no-store")
  if (c.req.method === "HEAD") {
    transcode.kill()
    void transcode.done.catch(() => undefined)
    await rm(scratchDir, { recursive: true, force: true }).catch(
      () => undefined,
    )
    return c.body(null)
  }

  return stream(c, async (s) => {
    try {
      await pipeReadable(s, transcode.stdout)
      await transcode.done.catch((err) => {
        if (!s.aborted) {
          logger.error(
            `[clips] live transcode failed for ${row.id} at ${quality.label}:`,
            err,
          )
          throw err
        }
      })
    } finally {
      transcode.kill()
      await rm(scratchDir, { recursive: true, force: true }).catch((err) => {
        logger.warn(
          `[clips] failed to remove live transcode scratch ${scratchDir}:`,
          err,
        )
      })
    }
  })
}

async function streamOpenGraphVideo(
  c: Context,
  row: OpenGraphClipRow,
): Promise<Response> {
  const sourceKey = row.sourceKey
  if (!sourceKey) return notFound(c, "OpenGraph unavailable")

  const source = await clipStorage.resolve(sourceKey)
  if (!source) return notFound(c, "OpenGraph unavailable")

  if (isOpenGraphCompatibleSource(row)) {
    return streamResolved(c, source, "video/mp4", "public, max-age=300")
  }

  return await streamOnDemandOpenGraphTranscode(c, row)
}

async function streamOnDemandOpenGraphTranscode(
  c: Context,
  row: OpenGraphClipRow,
): Promise<Response> {
  const sourceKey = row.sourceKey
  if (!sourceKey) return notFound(c, "OpenGraph unavailable")

  await mkdir(ENCODE_DIR, { recursive: true })
  const scratchDir = await mkdtemp(`${ENCODE_DIR}/${row.id}-og-`)
  const sourcePath = join(scratchDir, "source")
  const outPath = join(scratchDir, "opengraph.mp4")

  try {
    await clipStorage.downloadToFile(sourceKey, sourcePath)
    const probed = await probe(sourcePath)
    const config = configStore.get("encoder")
    await encode(sourcePath, outPath, {
      config: {
        hwaccel: config.hwaccel,
        encoder: codecNameFor(config.hwaccel, "h264"),
        quality: 23,
        audioBitrateKbps: 256,
        extraInputArgs: "",
        extraOutputArgs: "",
        qsvDevice: config.qsvDevice,
        vaapiDevice: config.vaapiDevice,
        intelLowPowerH264: config.intelLowPowerH264,
        intelLowPowerHevc: config.intelLowPowerHevc,
        tonemapping: config.tonemapping,
        sourceColor: probed.color,
      },
      targetHeight: Math.min(probed.height, 1080),
      durationMs: probed.durationMs,
      onProgress: () => undefined,
      signal: c.req.raw.signal,
    })

    const outStat = await stat(outPath)
    c.header("Content-Type", "video/mp4")
    c.header("Content-Length", String(outStat.size))
    c.header("Accept-Ranges", "none")
    c.header("Cache-Control", "public, max-age=300")
    if (c.req.method === "HEAD") {
      await rm(scratchDir, { recursive: true, force: true }).catch(
        () => undefined,
      )
      return c.body(null)
    }

    const file = createReadStream(outPath)
    const readable = Readable.toWeb(file) as ReadableStream<Uint8Array>
    return stream(c, async (s) => {
      try {
        await pipeReadable(s, readable)
      } finally {
        file.destroy()
        await rm(scratchDir, { recursive: true, force: true }).catch((err) => {
          logger.warn(
            `[clips] failed to remove OpenGraph transcode scratch ${scratchDir}:`,
            err,
          )
        })
      }
    })
  } catch (err) {
    await rm(scratchDir, { recursive: true, force: true }).catch(
      () => undefined,
    )
    if (c.req.raw.signal.aborted) throw err
    logger.error(`[clips] OpenGraph transcode failed for ${row.id}:`, err)
    return notFound(c, "OpenGraph unavailable")
  }
}

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

    const resolved = await clipStorage.resolve(key)
    if (!resolved) return notFound(c, "No thumbnail")

    c.header("Content-Type", resolved.contentType)
    c.header("Content-Length", String(resolved.size))
    c.header("Cache-Control", thumbCacheControl)
    if (c.req.method === "HEAD") return c.body(null)

    const buf = await readAll(resolved.stream())
    return c.body(
      buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer,
    )
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
