import { createReadStream } from "node:fs"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { Readable } from "node:stream"

import type { ClipPlaybackQuality, ClipPrivacy } from "alloy-contracts"
import { logger } from "alloy-logging"
import { type Context } from "hono"
import { stream } from "hono/streaming"

import { parseRequestedLiveCodecs, selectLiveCodec } from "../clips/live-codec"
import { isOpenGraphCompatibleSource } from "../clips/opengraph"
import { configStore } from "../config/store"
import { codecNameFor, encode, liveTranscode, probe } from "../queue/ffmpeg"
import { ENCODE_DIR } from "../runtime/dirs"
import { notFound } from "../runtime/http-response"
import { join } from "../runtime/path"
import { pipeReadable } from "../runtime/streaming"
import { clipStorage } from "../storage"
import { parseRange, readAll } from "./clips-helpers"
import type { LiveTranscodeClipRow } from "./clips-playback-hls"

type ResolvedStorageObject = NonNullable<
  Awaited<ReturnType<typeof clipStorage.resolve>>
>

export type OpenGraphClipRow = {
  id: string
  sourceKey: string | null
  sourceContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  durationMs: number | null
  height: number | null
}

export function mediaCacheControl(privacy: ClipPrivacy): string {
  return privacy === "public"
    ? "public, max-age=300"
    : privacy === "private"
      ? "no-store"
      : "private, max-age=300"
}

export function streamResolved(
  c: Context,
  resolved: ResolvedStorageObject,
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

export async function streamLiveQuality(
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

export async function streamOpenGraphVideo(
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

export async function streamThumbnail(
  c: Context,
  key: string,
  cacheControl: string,
): Promise<Response> {
  const resolved = await clipStorage.resolve(key)
  if (!resolved) return notFound(c, "No thumbnail")

  c.header("Content-Type", resolved.contentType)
  c.header("Content-Length", String(resolved.size))
  c.header("Cache-Control", cacheControl)
  if (c.req.method === "HEAD") return c.body(null)

  const buf = await readAll(resolved.stream())
  return c.body(
    buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer,
  )
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
