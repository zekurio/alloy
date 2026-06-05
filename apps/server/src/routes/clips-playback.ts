import { zValidator } from "./validation"
import { type Context, Hono } from "hono"
import { stream } from "hono/streaming"
import { logger } from "@workspace/logging"

import {
  applyClipPrivacyHeaders,
  clipAccessResponse,
  resolveClipAccess,
} from "../clips/access"
import { clipStorage } from "../storage"
import { configStore } from "../config/store"
import {
  buildPlaybackQualities,
  findPlaybackQuality,
} from "../clips/playback-quality"
import { isOpenGraphCompatibleSource } from "../clips/opengraph"
import { parseRequestedLiveCodecs, selectLiveCodec } from "../clips/live-codec"
import { ENCODE_DIR } from "../runtime/dirs"
import { notFound } from "../runtime/http-response"
import { join } from "../runtime/path"
import { pipeReadable } from "../runtime/streaming"
import { codecNameFor, encode, liveTranscode, probe } from "../queue/ffmpeg"
import {
  contentDisposition,
  downloadFilename,
  DownloadQuery,
  IdParam,
  parseRange,
  readAll,
  StreamQuery,
} from "./clips-helpers"
import type { ClipPlaybackQuality, ClipPrivacy } from "@workspace/contracts"

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

  await Deno.mkdir(ENCODE_DIR, { recursive: true })
  const scratchDir = await Deno.makeTempDir({
    dir: ENCODE_DIR,
    prefix: `${row.id}-live-`,
  })
  const sourcePath = join(scratchDir, "source")
  try {
    await clipStorage.downloadToFile(sourceKey, sourcePath)
  } catch (err) {
    await Deno.remove(scratchDir, { recursive: true }).catch(() => undefined)
    logger.error(
      `[clips] failed to stage source for live transcode ${row.id}:`,
      err,
    )
    return notFound(c, "Source unavailable")
  }

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
    await Deno.remove(scratchDir, { recursive: true }).catch(() => undefined)
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
      await Deno.remove(scratchDir, { recursive: true }).catch((err) => {
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

  await Deno.mkdir(ENCODE_DIR, { recursive: true })
  const scratchDir = await Deno.makeTempDir({
    dir: ENCODE_DIR,
    prefix: `${row.id}-og-`,
  })
  const sourcePath = join(scratchDir, "source")
  const outPath = join(scratchDir, "opengraph.mp4")

  try {
    await clipStorage.downloadToFile(sourceKey, sourcePath)
    const probed = row.height && row.durationMs
      ? { height: row.height, durationMs: row.durationMs }
      : await probe(sourcePath)
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
      },
      targetHeight: Math.min(probed.height, 1080),
      durationMs: probed.durationMs,
      onProgress: () => undefined,
      signal: c.req.raw.signal,
    })

    const stat = await Deno.stat(outPath)
    c.header("Content-Type", "video/mp4")
    c.header("Content-Length", String(stat.size))
    c.header("Accept-Ranges", "none")
    c.header("Cache-Control", "public, max-age=300")
    if (c.req.method === "HEAD") {
      await Deno.remove(scratchDir, { recursive: true }).catch(() => undefined)
      return c.body(null)
    }

    const file = await Deno.open(outPath, { read: true })
    return stream(c, async (s) => {
      try {
        await pipeReadable(s, file.readable)
      } finally {
        try {
          file.close()
        } catch {
          // The readable side may already have closed the file descriptor.
        }
        await Deno.remove(scratchDir, { recursive: true }).catch((err) => {
          logger.warn(
            `[clips] failed to remove OpenGraph transcode scratch ${scratchDir}:`,
            err,
          )
        })
      }
    })
  } catch (err) {
    await Deno.remove(scratchDir, { recursive: true }).catch(() => undefined)
    if (c.req.raw.signal.aborted) throw err
    logger.error(`[clips] OpenGraph transcode failed for ${row.id}:`, err)
    return notFound(c, "OpenGraph unavailable")
  }
}

export const clipsPlaybackRoutes = new Hono()
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

      const wantsSource = !requestedVariant ||
        requestedVariant === "auto" ||
        requestedVariant === "source"
      const selected = wantsSource && row.sourceKey && row.sourceContentType
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

    const thumbCacheControl = row.privacy === "public" && row.status === "ready"
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

      const selected = requestedVariant === "source"
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

      const dlCacheControl = row.privacy === "public"
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
