import { readFile, rm } from "node:fs/promises"

import {
  UNIFORM_IMAGE_CHANNEL_RANGE_THRESHOLD,
  UNIFORM_IMAGE_SAMPLE_MAX_DIMENSION,
  UNIFORM_IMAGE_VARIANCE_THRESHOLD,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { join } from "@alloy/server/runtime/path"
import sharp, { type Sharp } from "sharp"

import { imageBlurHashFromBytes } from "./blurhash"
import { runFfmpeg } from "./ffmpeg"

const logger = createLogger("media")

const POSTER_JPEG_QUALITY = 82
const POSTER_MAX_WIDTH = 1280
const EXTRACT_TIMEOUT_MS = 60_000

export interface ExtractedPoster {
  jpeg: Buffer
  blurHash: string
}

/**
 * Poster frame extraction: grab a frame at the requested timestamp or from the
 * standard automatic candidates, and return a JPEG + BlurHash. Returns null
 * only when every checked candidate is blank/uniform. ffmpeg/sharp failures are
 * transient and throw so callers can retry later.
 */
export async function extractPoster(
  videoPath: string,
  workDir: string,
  opts: {
    durationMs: number
    atMs?: number
    allowUniform?: boolean
    signal?: AbortSignal
  },
): Promise<ExtractedPoster | null> {
  const framePath = join(workDir, "poster-frame.png")
  for (const seekMs of posterCandidateTimes(opts)) {
    await extractFrame(videoPath, framePath, seekMs / 1000, opts.signal)

    const poster = await readPosterFrame(framePath, {
      allowUniform: opts.allowUniform ?? false,
    })
    if (poster) return poster
  }

  logger.warn(`poster extraction produced no usable frame for ${videoPath}`)
  return null
}

function posterCandidateTimes(opts: { durationMs: number; atMs?: number }) {
  if (opts.atMs !== undefined) {
    return uniqueClampedTimes([opts.atMs], opts.durationMs)
  }
  return uniqueClampedTimes(
    [
      Math.min(1000, opts.durationMs - 100),
      opts.durationMs * 0.1,
      opts.durationMs * 0.5,
      100,
      0,
    ],
    opts.durationMs,
  )
}

function uniqueClampedTimes(timesMs: number[], durationMs: number): number[] {
  const maxMs = Math.max(0, durationMs - 50)
  const result: number[] = []
  for (const timeMs of timesMs) {
    if (!Number.isFinite(timeMs)) continue
    const clamped = Math.round(Math.min(Math.max(0, timeMs), maxMs))
    if (!result.includes(clamped)) result.push(clamped)
  }
  return result.length > 0 ? result : [0]
}

async function readPosterFrame(
  framePath: string,
  options: { allowUniform: boolean },
): Promise<ExtractedPoster | null> {
  const frame = await readFile(framePath)
  try {
    const image = sharp(frame).resize(POSTER_MAX_WIDTH, null, {
      withoutEnlargement: true,
    })
    await rm(framePath, { force: true }).catch(() => undefined)
    if (!options.allowUniform && (await isUniformFrame(image))) return null
    const jpeg = await image
      .clone()
      .jpeg({ quality: POSTER_JPEG_QUALITY })
      .toBuffer()
    return { jpeg, blurHash: await imageBlurHashFromBytes(jpeg) }
  } finally {
    await rm(framePath, { force: true }).catch(() => undefined)
  }
}

async function isUniformFrame(image: Sharp): Promise<boolean> {
  const stats = await image
    .clone()
    .resize(
      UNIFORM_IMAGE_SAMPLE_MAX_DIMENSION,
      UNIFORM_IMAGE_SAMPLE_MAX_DIMENSION,
      {
        fit: "inside",
        withoutEnlargement: true,
        fastShrinkOnLoad: true,
      },
    )
    .removeAlpha()
    .stats()
  return stats.channels.every(
    (channel) =>
      channel.max - channel.min <= UNIFORM_IMAGE_CHANNEL_RANGE_THRESHOLD &&
      channel.stdev <= UNIFORM_IMAGE_VARIANCE_THRESHOLD,
  )
}

async function extractFrame(
  videoPath: string,
  framePath: string,
  seekSec: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  // -ss before -i uses the fast keyframe seek, which is reliable even for
  // large high-bitrate sources.
  await runFfmpeg({
    timeoutMs: EXTRACT_TIMEOUT_MS,
    signal,
    args: [
      "-v",
      "error",
      "-y",
      "-ss",
      seekSec.toFixed(3),
      "-i",
      videoPath,
      "-vf",
      "scale=min(1280\\,iw):-2",
      "-pix_fmt",
      "rgb24",
      "-frames:v",
      "1",
      framePath,
    ],
  })
}
