import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"

import {
  UNIFORM_IMAGE_CHANNEL_RANGE_THRESHOLD,
  UNIFORM_IMAGE_SAMPLE_MAX_DIMENSION,
  UNIFORM_IMAGE_VARIANCE_THRESHOLD,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { errorMessage } from "@alloy/server/runtime/error-message"
import type { Sharp } from "sharp"

import { imageBlurHashFromBytes } from "./blurhash"
import { runFfmpeg } from "./ffmpeg"
import { processFailureKind } from "./run-process"
import { loadSharp } from "./sharp"

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
 * standard automatic candidates, and return a JPEG + BlurHash. The rules are
 * the desktop library's (`capture_library/poster.rs`), so a clip keeps its
 * picture after upload:
 * - a candidate whose grab fails is skipped, since one seek can fail where
 *   another works, e.g. past the end of a video stream the audio outlasts;
 * - the first blank frame is the fallback, so a clip that is black throughout
 *   gets its earliest frame rather than no poster.
 *
 * Returns null only when no candidate yields a frame, the one terminal
 * outcome. A timeout before any frame, an ffmpeg that cannot start and a
 * sharp failure throw: they say nothing about the media, so callers retry.
 */
export async function extractPoster(
  videoPath: string,
  workDir: string,
  opts: {
    durationMs: number
    atMs?: number
    signal?: AbortSignal
  },
): Promise<ExtractedPoster | null> {
  const framePath = join(workDir, "poster-frame.png")
  let blank: Sharp | null = null
  let failure: string | null = null
  for (const seekMs of posterCandidateTimes(opts)) {
    let frame: Buffer | null
    try {
      frame = await grabFrame(videoPath, framePath, seekMs / 1000, opts.signal)
    } catch (cause) {
      if (opts.signal?.aborted) throw cause
      const kind = processFailureKind(cause)
      if (kind === "exit") {
        failure ??= errorMessage(cause, "ffmpeg failed")
        continue
      }
      // Every later seek into a file this slow would take as long, so settle
      // for the blank frame an earlier candidate found.
      if (kind === "timeout" && blank) break
      throw cause
    }
    if (!frame) continue
    const sharp = await loadSharp()
    const image = sharp(frame).resize(POSTER_MAX_WIDTH, null, {
      withoutEnlargement: true,
    })
    if (!(await isUniformFrame(image))) return encodePoster(image)
    blank ??= image
  }
  if (blank) return encodePoster(blank)

  logger.warn(
    `poster extraction produced no usable frame for ${videoPath}:`,
    failure ?? "ffmpeg wrote no frame",
  )
  return null
}

function posterCandidateTimes(opts: { durationMs: number; atMs?: number }) {
  if (opts.atMs !== undefined) {
    return uniqueClampedTimes([opts.atMs], opts.durationMs)
  }
  // The opening frame first: it is the frame playback reveals, so any later
  // candidate makes the thumbnail and the starting picture two different
  // images. The rest are fallbacks for clips that open on a blank frame.
  return uniqueClampedTimes(
    [
      0,
      100,
      Math.min(1000, opts.durationMs - 100),
      opts.durationMs * 0.1,
      opts.durationMs * 0.5,
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

/**
 * One candidate frame, or null when ffmpeg exits cleanly without writing
 * one, as it does for a seek past the last frame.
 */
async function grabFrame(
  videoPath: string,
  framePath: string,
  seekSec: number,
  signal: AbortSignal | undefined,
): Promise<Buffer | null> {
  try {
    await extractFrame(videoPath, framePath, seekSec, signal)
    return await readFile(framePath).catch((cause: unknown) => {
      if (isMissingFile(cause)) return null
      throw cause
    })
  } finally {
    await rm(framePath, { force: true }).catch(() => undefined)
  }
}

function isMissingFile(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT"
}

async function encodePoster(image: Sharp): Promise<ExtractedPoster> {
  const jpeg = await image
    .clone()
    .jpeg({ quality: POSTER_JPEG_QUALITY })
    .toBuffer()
  return { jpeg, blurHash: await imageBlurHashFromBytes(jpeg) }
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
