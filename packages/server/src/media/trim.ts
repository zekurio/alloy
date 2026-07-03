import { runFfmpeg, transcodeTimeoutMs } from "./ffmpeg"

/**
 * Cut `[startMs, endMs]` out of `srcPath` into an MP4 at `outPath` without
 * re-encoding. The input seek snaps to the nearest preceding video keyframe —
 * accepted: desktop performs frame-accurate trims before upload, this path
 * only serves owner trims of already-published clips. `+faststart` keeps the
 * output streaming progressively.
 */
export async function trimToMp4(
  srcPath: string,
  outPath: string,
  opts: {
    startMs: number
    endMs: number
    signal?: AbortSignal
  },
): Promise<void> {
  await runFfmpeg({
    timeoutMs: transcodeTimeoutMs(opts.endMs - opts.startMs),
    signal: opts.signal,
    args: [
      "-v",
      "error",
      "-y",
      "-ss",
      String(opts.startMs / 1000),
      "-i",
      srcPath,
      "-t",
      String((opts.endMs - opts.startMs) / 1000),
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      "-movflags",
      "+faststart",
      outPath,
    ],
  })
}
