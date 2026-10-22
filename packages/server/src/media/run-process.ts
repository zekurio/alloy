import { spawn } from "node:child_process"
import { setPriority } from "node:os"
import type { Readable } from "node:stream"

import { abortError } from "@alloy/server/runtime/error-message"

/** Grace period between SIGTERM and SIGKILL when stopping a stuck process. */
export const KILL_GRACE_MS = 5_000

/**
 * Why a process run failed: it never started, it ran out of time, or it
 * exited with an error. Only an exit is about the input itself, so callers
 * that try several inputs in turn, like the poster candidates, move on after
 * an exit and stop on the other two.
 */
export type ProcessFailureKind = "start" | "timeout" | "exit"

class ProcessError extends Error {
  constructor(
    message: string,
    readonly kind: ProcessFailureKind,
    readonly exitCode: number | null,
    detail: string,
  ) {
    super(detail ? `${message}\n${detail}` : message)
    this.name = "ProcessError"
  }
}

export function processFailureKind(cause: unknown): ProcessFailureKind | null {
  return cause instanceof ProcessError ? cause.kind : null
}

export interface RunProcessOptions {
  /** Name used in error messages, e.g. "ffmpeg". */
  name: string
  command: string
  args: readonly string[]
  timeoutMs: number
  cwd?: string
  signal?: AbortSignal
  /** Best-effort scheduling priority for the child (see `os.setPriority`). */
  priority?: number
  /** Called per stdout line. Without it, stdout is not captured at all. */
  onStdoutLine?: (line: string) => void
  /** Called per stderr line. Without it, stderr is not captured at all. */
  onStderrLine?: (line: string) => void
  /** Text appended to a failure's message, such as a stderr tail. */
  failureDetail?: () => string
}

/**
 * Run a child process to completion. It resolves on exit code 0, rejects with
 * an AbortError when `signal` aborts, and otherwise rejects with an error that
 * {@link processFailureKind} classifies. On abort or timeout the process gets
 * SIGTERM, then SIGKILL after {@link KILL_GRACE_MS}, so a process that ignores
 * SIGTERM can't hold its caller forever.
 */
export function runProcess(opts: RunProcessOptions): Promise<void> {
  if (opts.signal?.aborted) return Promise.reject(abortError())

  const child = spawn(opts.command, opts.args, {
    stdio: [
      "ignore",
      opts.onStdoutLine ? "pipe" : "ignore",
      opts.onStderrLine ? "pipe" : "ignore",
    ],
    cwd: opts.cwd,
  })

  if (opts.priority !== undefined && child.pid !== undefined) {
    try {
      setPriority(child.pid, opts.priority)
    } catch {
      // Unsupported platforms and already-exited processes keep the default.
    }
  }

  const flushStdout = readLines(child.stdout, opts.onStdoutLine)
  const flushStderr = readLines(child.stderr, opts.onStderrLine)

  let timedOut = false
  let aborted = false
  let hardKill: ReturnType<typeof setTimeout> | null = null
  const stop = () => {
    child.kill("SIGTERM")
    hardKill ??= setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
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

  const fail = (
    message: string,
    kind: ProcessFailureKind,
    exitCode: number | null,
  ) => new ProcessError(message, kind, exitCode, opts.failureDetail?.() ?? "")

  return new Promise<void>((resolve, reject) => {
    // `error` also fires when kill() fails; only a missing pid means the
    // process never started. Otherwise keep waiting for `close`, and keep
    // listening so a second failed kill() isn't an unhandled error event.
    child.on("error", (err) => {
      if (child.pid !== undefined) return
      reject(
        fail(
          `Failed to start ${opts.name} (${opts.command}): ${err.message}`,
          "start",
          null,
        ),
      )
    })
    child.once("close", (code) => {
      flushStdout()
      flushStderr()
      if (aborted) {
        reject(abortError())
        return
      }
      if (timedOut) {
        reject(
          fail(
            `${opts.name} timed out after ${Math.round(opts.timeoutMs / 1000)}s`,
            "timeout",
            code,
          ),
        )
        return
      }
      if (code !== 0) {
        reject(fail(`${opts.name} exited with code ${code}`, "exit", code))
        return
      }
      resolve()
    })
  }).finally(() => {
    clearTimeout(timeout)
    if (hardKill) clearTimeout(hardKill)
    opts.signal?.removeEventListener("abort", onAbort)
  })
}

/** Split a stream into lines; the returned flush emits a final partial line. */
function readLines(
  stream: Readable | null,
  onLine: ((line: string) => void) | undefined,
): () => void {
  if (!stream || !onLine) return () => undefined
  let remainder = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    remainder += chunk
    const lines = remainder.split("\n")
    remainder = lines.pop() ?? ""
    for (const line of lines) onLine(line)
  })
  return () => {
    if (remainder) onLine(remainder)
    remainder = ""
  }
}
