import { readFile, rm } from "node:fs/promises"

import { createLogger } from "@alloy/logging"
import { join } from "@alloy/server/runtime/path"
import sharp from "sharp"

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
 * Poster frame extraction: grab a frame at the requested timestamp — or a
 * bit into the video when none is given (fast keyframe seek) — retry at the
 * first frame when the seek lands outside the stream, and return a JPEG +
 * BlurHash matching what client-rendered posters provide. Returns null when
 * extraction fails — a missing poster must never fail the media run.
 */
export async function extractPoster(
  videoPath: string,
  workDir: string,
  opts: { durationMs: number; atMs?: number; signal?: AbortSignal },
): Promise<ExtractedPoster | null> {
  const framePath = join(workDir, "poster-frame.png")
  const seekSec = Math.max(
    0,
    opts.atMs !== undefined ? opts.atMs / 1000 : (opts.durationMs / 1000) * 0.1,
  )

  const extracted =
    (await extractFrame(videoPath, framePath, seekSec, opts.signal)) ||
    (seekSec > 0 && (await extractFrame(videoPath, framePath, 0, opts.signal)))
  if (!extracted) {
    logger.warn(`poster extraction failed for ${videoPath}`)
    return null
  }

  const frame = await readFile(framePath)
  await rm(framePath, { force: true }).catch(() => undefined)
  const jpeg = await sharp(frame)
    .resize(POSTER_MAX_WIDTH, null, { withoutEnlargement: true })
    .jpeg({ quality: POSTER_JPEG_QUALITY })
    .toBuffer()
  return { jpeg, blurHash: await imageBlurHashFromBytes(jpeg) }
}

async function extractFrame(
  videoPath: string,
  framePath: string,
  seekSec: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
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
        "-frames:v",
        "1",
        framePath,
      ],
    })
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    return false
  }
}
