import { spawn } from "node:child_process"
import { setPriority } from "node:os"

import { transcodeSettings } from "./transcode-settings"

const STDERR_TAIL_LINES = 100

/** Grace period between SIGTERM and SIGKILL when stopping a stuck process. */
const KILL_GRACE_MS = 5_000

const MIN_TIMEOUT_MS = 5 * 60 * 1000
const MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000

/**
 * Timeout for a transcode of a clip with the given duration: generous enough
 * for slow CPU encodes (~30x realtime worst case), clamped so very short clips
 * still get a workable window and a wedged process can't run for hours.
 */
export function transcodeTimeoutMs(durationMs: number): number {
  return Math.min(Math.max(durationMs * 30, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}

/**
 * Why an ffmpeg run failed: it never started, it ran out of time, or it
 * exited with an error. Only an exit is about the input itself, so callers
 * that try several inputs in turn, like the poster candidates, move on after
 * an exit and stop on the other two.
 */
export type FfmpegFailureKind = "start" | "timeout" | "exit"

class FfmpegError extends Error {
  constructor(
    message: string,
    readonly kind: FfmpegFailureKind,
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(stderrTail ? `${message}\n${stderrTail}` : message)
    this.name = "FfmpegError"
  }
}

export function ffmpegFailureKind(cause: unknown): FfmpegFailureKind | null {
  return cause instanceof FfmpegError ? cause.kind : null
}

/**
 * Run ffmpeg with the given output args. Progress is parsed from
 * `-progress pipe:1` key=value output and reported as seconds of media
 * written, so callers can turn it into a percentage against a known duration.
 * The process is SIGTERM'd (then SIGKILL'd) on abort or timeout; the last
 * stderr lines are attached to thrown errors for diagnosis.
 */
export function runFfmpeg(opts: {
  args: string[]
  timeoutMs: number
  cwd?: string
  signal?: AbortSignal
  onProgress?: (outTimeSec: number) => void
}): Promise<void> {
  if (opts.signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"))
  }

  const ffmpegPath = transcodeSettings().ffmpegPath
  const child = spawn(
    ffmpegPath,
    ["-hide_banner", "-nostdin", "-progress", "pipe:1", ...opts.args],
    { stdio: ["ignore", "pipe", "pipe"], cwd: opts.cwd },
  )

  // Encoding is background work; deprioritize it so it never starves the API
  // event loop or other services on small hosts. Best-effort: unsupported
  // platforms and already-exited processes just keep the default priority.
  if (child.pid !== undefined) {
    try {
      setPriority(child.pid, 10)
    } catch {
      // ignored
    }
  }

  const stderrTail: string[] = []
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue
      stderrTail.push(line)
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift()
    }
  })

  let stdoutRemainder = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdoutRemainder += chunk
    const lines = stdoutRemainder.split("\n")
    stdoutRemainder = lines.pop() ?? ""
    for (const line of lines) {
      const [key, value] = line.trim().split("=", 2)
      if (key !== "out_time_us" || value === undefined) continue
      const outTimeUs = Number(value)
      if (Number.isFinite(outTimeUs) && outTimeUs >= 0) {
        opts.onProgress?.(outTimeUs / 1_000_000)
      }
    }
  })

  let timedOut = false
  let aborted = false
  const stop = () => {
    child.kill("SIGTERM")
    const hardKill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
    hardKill.unref()
  }
  const timeout = setTimeout(() => {
    timedOut = true
    stop()
  }, opts.timeoutMs)
  const onAbort = () => {
    aborted = true
    stop()
  }
  opts.signal?.addEventListener("abort", onAbort, { once: true })

  return new Promise<void>((resolve, reject) => {
    child.once("error", (err) => {
      reject(
        new FfmpegError(
          `Failed to start ffmpeg (${ffmpegPath}): ${err.message}`,
          "start",
          null,
          "",
        ),
      )
    })
    child.once("close", (code) => {
      if (aborted) {
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      if (timedOut) {
        reject(
          new FfmpegError(
            `ffmpeg timed out after ${Math.round(opts.timeoutMs / 1000)}s`,
            "timeout",
            code,
            stderrTail.join("\n"),
          ),
        )
        return
      }
      if (code !== 0) {
        reject(
          new FfmpegError(
            `ffmpeg exited with code ${code}`,
            "exit",
            code,
            stderrTail.join("\n"),
          ),
        )
        return
      }
      resolve()
    })
  }).finally(() => {
    clearTimeout(timeout)
    opts.signal?.removeEventListener("abort", onAbort)
  })
}
