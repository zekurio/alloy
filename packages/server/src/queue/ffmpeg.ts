import { spawn } from "node:child_process"
import { Readable } from "node:stream"

import { env } from "../env"
import {
  buildEncodeArgs,
  buildLiveHlsArgs,
  buildLiveTranscodeArgs,
  type LiveHlsOpts,
  type LiveTranscodeOpts,
  type ResolvedEncoderConfig,
} from "./ffmpeg-args"
import { runWithProgress } from "./ffmpeg-process"

export {
  buildEncodeArgs,
  buildLiveHlsArgs,
  buildLiveTranscodeArgs,
  codecNameFor,
  type LiveHlsOpts,
  type ResolvedEncoderConfig,
  type SourceColorInfo,
} from "./ffmpeg-args"
export { probe } from "./ffmpeg-probe"

interface EncodeJob {
  config: ResolvedEncoderConfig
  targetHeight: number
  durationMs: number
  onProgress: (pct: number) => void
  signal?: AbortSignal
}

/** Run an ffmpeg invocation that does not report encode progress. */
async function runFfmpeg(
  args: string[],
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  await runWithProgress(env.FFMPEG_BIN, args, () => undefined, {
    label,
    signal,
  })
}

/** Translate ffmpeg `-progress` output lines into a 0-99 percentage. */
function progressHandler(
  durationMs: number,
  onProgress: (pct: number) => void,
): (line: string) => void {
  return (line) => {
    const m =
      /^out_time_us=(-?\d+)/m.exec(line) ?? /^out_time_ms=(-?\d+)/m.exec(line)
    if (!m) return
    const microseconds = Number.parseInt(m[1] ?? "0", 10)
    if (!Number.isFinite(microseconds) || microseconds < 0) return
    const ms = microseconds / 1000
    const pct = Math.min(99, Math.max(0, Math.floor((ms / durationMs) * 100)))
    onProgress(pct)
  }
}

export async function encode(
  srcPath: string,
  outPath: string,
  opts: EncodeJob,
): Promise<void> {
  await runWithProgress(
    env.FFMPEG_BIN,
    buildEncodeArgs(srcPath, outPath, opts),
    progressHandler(opts.durationMs, opts.onProgress),
    { label: `encode ${opts.targetHeight}p`, signal: opts.signal },
  )
}

export function liveTranscode(
  srcPath: string,
  opts: LiveTranscodeOpts,
): {
  stdout: ReadableStream<Uint8Array>
  done: Promise<void>
  kill: () => void
} {
  const child = spawn(env.FFMPEG_BIN, buildLiveTranscodeArgs(srcPath, opts), {
    stdio: ["ignore", "pipe", "pipe"],
  })
  const exit = new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve(code ?? 1))
  })

  const done = ffmpegDone(child, exit, "ffmpeg live transcode")

  if (!child.stdout) {
    throw new Error("ffmpeg stdout pipe unavailable")
  }

  return {
    stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    done,
    kill: () => {
      try {
        child.kill("SIGTERM")
      } catch {
        // The child may already have exited by the time cleanup runs.
      }
    },
  }
}

export function liveHls(
  srcPath: string,
  playlistPath: string,
  opts: LiveHlsOpts,
): {
  done: Promise<void>
  kill: () => void
} {
  const child = spawn(
    env.FFMPEG_BIN,
    buildLiveHlsArgs(srcPath, playlistPath, opts),
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  )
  const exit = new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve(code ?? 1))
  })

  const done = ffmpegDone(child, exit, "ffmpeg live hls")

  return {
    done,
    kill: () => {
      try {
        child.kill("SIGTERM")
      } catch {
        // The child may already have exited by the time cleanup runs.
      }
    },
  }
}

function ffmpegDone(
  child: { stderr: NodeJS.ReadableStream },
  exit: Promise<number>,
  label: string,
): Promise<void> {
  const stderr = collectTail(child.stderr)
  return exit.then(async (code) => {
    const detail = (await stderr).trim()
    if (code !== 0) {
      throw new Error(
        `${label} exited with code ${code}` + (detail ? `:\n${detail}` : ""),
      )
    }
  })
}

async function collectTail(
  stream: NodeJS.ReadableStream,
  maxBytes = 8_192,
): Promise<string> {
  const decoder = new TextDecoder()
  let output = ""
  try {
    for await (const chunk of stream) {
      output += decoder.decode(chunk as Buffer, { stream: true })
      if (output.length > maxBytes) output = output.slice(-maxBytes)
    }
    output += decoder.decode()
  } catch {
    return output
  }
  return output
}

/**
 * Cuts `[startMs, endMs]` out of `srcPath` into an MP4 at `outPath` (must end
 * in `.mp4` so ffmpeg picks the muxer). Tries a fast stream copy first and
 * falls back to a re-encode when the container or codecs refuse to copy —
 * the same strategy the desktop capture trimmer uses.
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
  const start = msToFfmpegTimestamp(opts.startMs)
  const duration = msToFfmpegTimestamp(opts.endMs - opts.startMs)
  const inputArgs = [
    "-hide_banner",
    "-y",
    "-ss",
    start,
    "-i",
    srcPath,
    "-t",
    duration,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
  ]

  try {
    await runFfmpeg(
      [...inputArgs, "-c", "copy", "-movflags", "+faststart", outPath],
      "trim (stream copy)",
      opts.signal,
    )
  } catch (err) {
    if (opts.signal?.aborted) throw err
    await runFfmpeg(
      [
        ...inputArgs,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        outPath,
      ],
      "trim (re-encode)",
      opts.signal,
    )
  }
}

export async function thumbnail(
  srcPath: string,
  outPath: string,
  opts: {
    atMs: number
    signal?: AbortSignal
  },
): Promise<void> {
  await runFfmpeg(
    [
      "-hide_banner",
      "-y",
      "-ss",
      msToFfmpegTimestamp(opts.atMs),
      "-i",
      srcPath,
      "-frames:v",
      "1",
      "-vf",
      "scale='min(1280,iw)':-2:force_original_aspect_ratio=decrease",
      "-c:v",
      "libwebp",
      "-quality",
      "80",
      outPath,
    ],
    "thumbnail",
    opts.signal,
  )
}

function msToFfmpegTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return (
    `${hours.toString().padStart(2, "0")}:` +
    `${minutes.toString().padStart(2, "0")}:` +
    `${seconds.toString().padStart(2, "0")}.` +
    `${millis.toString().padStart(3, "0")}`
  )
}
