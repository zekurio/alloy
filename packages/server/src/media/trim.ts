import { trimToMp4Target } from "@alloy/media"
import { ALL_FORMATS, FilePathSource, FilePathTarget, Input } from "mediabunny"

/**
 * Cut `[startMs, endMs]` out of `srcPath` into an MP4 at `outPath` without
 * re-encoding. The cut start snaps to the nearest preceding video keyframe —
 * accepted: desktop performs frame-accurate trims before upload, this path
 * only serves owner trims of already-published clips.
 *
 * The packet-copy core lives in `@alloy/media` so the server, the desktop main
 * process, and the web upload editor all cut identically. The output is a
 * fragmented MP4 so it streams progressively without a second faststart pass.
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
  const input = new Input({
    source: new FilePathSource(srcPath),
    formats: ALL_FORMATS,
  })
  try {
    await trimToMp4Target({
      input,
      target: new FilePathTarget(outPath),
      startMs: opts.startMs,
      endMs: opts.endMs,
      signal: opts.signal,
    })
  } finally {
    input.dispose()
  }
}
