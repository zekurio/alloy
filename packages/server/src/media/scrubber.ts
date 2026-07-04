import {
  CLIP_SCRUBBER_COLUMNS,
  CLIP_SCRUBBER_FRAME_COUNT,
} from "@alloy/contracts"

import { runFfmpeg, transcodeTimeoutMs } from "./ffmpeg"

const SCRUBBER_FRAME_HEIGHT = 96
/** ffmpeg MJPEG quality scale (2 best – 31 worst). */
const SCRUBBER_JPEG_QUALITY = 5

/**
 * One-pass sprite sheet for the trim scrubber: evenly spaced frames scaled
 * to a small height and tiled into a single JPEG. Derived from the immutable
 * stored source, so it only ever needs to be generated once per clip.
 */
export async function generateScrubberSheet(
  sourcePath: string,
  outPath: string,
  opts: { durationMs: number; signal?: AbortSignal },
): Promise<void> {
  const rows = Math.ceil(CLIP_SCRUBBER_FRAME_COUNT / CLIP_SCRUBBER_COLUMNS)
  const frameIntervalSec = Math.max(
    0.001,
    opts.durationMs / 1000 / CLIP_SCRUBBER_FRAME_COUNT,
  )
  await runFfmpeg({
    timeoutMs: transcodeTimeoutMs(opts.durationMs),
    signal: opts.signal,
    args: [
      "-v",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-vf",
      `fps=1/${frameIntervalSec.toFixed(3)},scale=-2:${SCRUBBER_FRAME_HEIGHT},tile=${CLIP_SCRUBBER_COLUMNS}x${rows}`,
      "-frames:v",
      "1",
      "-q:v",
      String(SCRUBBER_JPEG_QUALITY),
      outPath,
    ],
  })
}
