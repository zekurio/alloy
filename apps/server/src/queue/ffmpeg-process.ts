import { logger } from "@workspace/logging"

import { isAbortError, toError } from "../runtime/error-message"

interface CaptureResult {
  stdout: string
  stderr: string
}

interface RunProcessOptions {
  label?: string
  signal?: AbortSignal
}

export async function runCapture(
  bin: string,
  args: ReadonlyArray<string>,
  opts: RunProcessOptions = {}
): Promise<CaptureResult> {
  const startedAt = Date.now()
  try {
    const output = await new Deno.Command(bin, {
      args: [...args],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output()
    const stdout = new TextDecoder().decode(output.stdout)
    const stderr = new TextDecoder().decode(output.stderr)
    if (output.success) {
      return { stdout, stderr }
    }
    logProcessFailure(bin, opts.label, startedAt, output.code, stderr)
    throw new Error(
      `${bin} exited ${output.code}: ${stderr.trim().slice(-500) || "(no stderr)"}`
    )
  } catch (err) {
    logProcessError(bin, opts.label, startedAt, err as Error)
    throw err
  }
}

export async function runWithProgress(
  bin: string,
  args: ReadonlyArray<string>,
  onLine: (line: string) => void,
  opts: RunProcessOptions = {}
): Promise<void> {
  const { signal } = opts
  if (signal?.aborted) throw abortError()
  const startedAt = Date.now()
  const command = new Deno.Command(bin, {
    args: [...args],
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  })
  const proc = command.spawn()
  let aborted = false
  const onAbort = () => {
    aborted = true
    proc.kill("SIGTERM")
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  let stderrTail = ""
  let buf = ""
  const decoder = new TextDecoder()
  try {
    if (!proc.stderr) throw new Error("stderr pipe unavailable")
    for await (const chunk of proc.stderr) {
      const text = decoder.decode(chunk, { stream: true })
      stderrTail = (stderrTail + text).slice(-2000)
      buf += text
      let idx: number
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line) onLine(line)
      }
    }
    const finalText = decoder.decode()
    if (finalText) {
      stderrTail = (stderrTail + finalText).slice(-2000)
      buf += finalText
    }
    const status = await proc.status
    signal?.removeEventListener("abort", onAbort)
    if (aborted) throw abortError()
    if (status.success) {
      if (buf) onLine(buf)
      return
    }
    logProcessFailure(bin, opts.label, startedAt, status.code, stderrTail)
    throw new Error(
      `${bin} exited ${status.code}: ${stderrTail.trim().slice(-500)}`
    )
  } catch (err) {
    signal?.removeEventListener("abort", onAbort)
    if (!isAbortError(err)) {
      logProcessError(
        bin,
        opts.label,
        startedAt,
        toError(err, "Process failed")
      )
    }
    throw err
  }
}

function abortError(): Error {
  // DOMException gives a properly-tagged `.name === "AbortError"` that
  // downstream `instanceof`-free checks can key off without importing.
  return new DOMException("Encode cancelled", "AbortError")
}

function logProcessFailure(
  bin: string,
  label: string | undefined,
  startedAt: number,
  code: number | null,
  stderr: string
): void {
  const tail = stderr.trim().slice(-1000) || "(no stderr)"
  logger.error(
    `[ffmpeg] ${processName(bin, label)} failed after ${Date.now() - startedAt}ms with exit ${code}: ${tail}`
  )
}

function logProcessError(
  bin: string,
  label: string | undefined,
  startedAt: number,
  err: Error
): void {
  logger.error(
    `[ffmpeg] ${processName(bin, label)} errored after ${Date.now() - startedAt}ms:`,
    err
  )
}

function processName(bin: string, label: string | undefined): string {
  const base = label ? `${label} (${bin})` : bin
  return base
}
