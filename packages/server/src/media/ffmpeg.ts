import { runProcess } from "./run-process"
import { transcodeSettings } from "./transcode-settings"

const STDERR_TAIL_LINES = 100

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
  const stderrTail: string[] = []
  return runProcess({
    name: "ffmpeg",
    command: transcodeSettings().ffmpegPath,
    args: ["-hide_banner", "-nostdin", "-progress", "pipe:1", ...opts.args],
    timeoutMs: opts.timeoutMs,
    cwd: opts.cwd,
    signal: opts.signal,
    // Encoding is background work; deprioritize it so it never starves the
    // API event loop or other services on small hosts.
    priority: 10,
    onStdoutLine: (line) => {
      const [key, value] = line.trim().split("=", 2)
      if (key !== "out_time_us" || value === undefined) return
      const outTimeUs = Number(value)
      if (Number.isFinite(outTimeUs) && outTimeUs >= 0) {
        opts.onProgress?.(outTimeUs / 1_000_000)
      }
    },
    onStderrLine: (line) => {
      if (!line.trim()) return
      stderrTail.push(line)
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift()
    },
    failureDetail: () => stderrTail.join("\n"),
  })
}
