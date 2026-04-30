import { env } from "../env"
import {
  buildEncodeArgs,
  buildRemuxArgs,
  type ResolvedEncoderConfig,
} from "./ffmpeg-args"
import { runWithProgress } from "./ffmpeg-process"

export {
  buildEncodeArgs,
  buildRemuxArgs,
  codecNameFor,
  parseExtraArgs,
  type ResolvedEncoderConfig,
} from "./ffmpeg-args"
export { probe, type ProbeResult } from "./ffmpeg-probe"

export async function encode(
  srcPath: string,
  outPath: string,
  opts: {
    config: ResolvedEncoderConfig
    targetHeight: number
    durationMs: number
    onProgress: (pct: number) => void
    trimStartMs?: number | null
    trimEndMs?: number | null
    signal?: AbortSignal
  }
): Promise<void> {
  const args = buildEncodeArgs(srcPath, outPath, opts)

  await runWithProgress(
    env.FFMPEG_BIN,
    args,
    (line) => {
      const m =
        /^out_time_us=(-?\d+)/m.exec(line) ?? /^out_time_ms=(-?\d+)/m.exec(line)
      if (!m) return
      const microseconds = Number.parseInt(m[1] ?? "0", 10)
      if (!Number.isFinite(microseconds) || microseconds < 0) return
      const ms = microseconds / 1000
      const pct = Math.min(
        99,
        Math.max(0, Math.floor((ms / opts.durationMs) * 100))
      )
      opts.onProgress(pct)
    },
    { label: `encode ${opts.targetHeight}p`, signal: opts.signal }
  )
}

export async function remuxToMp4(
  srcPath: string,
  outPath: string,
  opts: {
    trimStartMs?: number | null
    trimEndMs?: number | null
    signal?: AbortSignal
  }
): Promise<void> {
  await runWithProgress(
    env.FFMPEG_BIN,
    buildRemuxArgs(srcPath, outPath, opts),
    () => undefined,
    { label: "remux source", signal: opts.signal }
  )
}
