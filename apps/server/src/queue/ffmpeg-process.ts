import { spawn } from "node:child_process"

export interface CaptureResult {
  stdout: string
  stderr: string
}

interface RunProcessOptions {
  label?: string
  signal?: AbortSignal
}

export function runCapture(
  bin: string,
  args: ReadonlyArray<string>,
  opts: RunProcessOptions = {}
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    logProcessStart(bin, args, opts.label)
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    proc.on("error", (err) => {
      logProcessError(bin, opts.label, startedAt, err)
      reject(err)
    })
    proc.on("close", (code) => {
      if (code === 0) {
        logProcessSuccess(bin, opts.label, startedAt)
        resolve({ stdout, stderr })
      } else {
        logProcessFailure(bin, opts.label, startedAt, code, stderr)
        reject(
          new Error(
            `${bin} exited ${code}: ${stderr.trim().slice(-500) || "(no stderr)"}`
          )
        )
      }
    })
  })
}

export function runWithProgress(
  bin: string,
  args: ReadonlyArray<string>,
  onLine: (line: string) => void,
  opts: RunProcessOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { signal } = opts
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const startedAt = Date.now()
    logProcessStart(bin, args, opts.label)
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderrTail = ""
    let buf = ""
    let aborted = false
    proc.stderr.on("data", (chunk) => {
      const text = String(chunk)
      stderrTail = (stderrTail + text).slice(-2000)
      buf += text
      let idx: number
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line) onLine(line)
      }
    })
    // Deliver SIGTERM on abort; the `close` handler resolves the
    // promise as AbortError because `aborted` is set.
    const onAbort = () => {
      aborted = true
      proc.kill("SIGTERM")
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    proc.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort)
      logProcessError(bin, opts.label, startedAt, err)
      reject(err)
    })
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort)
      if (aborted) {
        reject(abortError())
        return
      }
      if (code === 0) {
        if (buf) onLine(buf)
        logProcessSuccess(bin, opts.label, startedAt)
        resolve()
      } else {
        logProcessFailure(bin, opts.label, startedAt, code, stderrTail)
        reject(
          new Error(`${bin} exited ${code}: ${stderrTail.trim().slice(-500)}`)
        )
      }
    })
  })
}

function abortError(): Error {
  // DOMException gives a properly-tagged `.name === "AbortError"` that
  // downstream `instanceof`-free checks can key off without importing.
  return new DOMException("Encode cancelled", "AbortError")
}

function logProcessStart(
  _bin: string,
  _args: ReadonlyArray<string>,
  _label: string | undefined
): void {
  return undefined
}

function logProcessSuccess(
  _bin: string,
  _label: string | undefined,
  _startedAt: number
): void {
  return undefined
}

function logProcessFailure(
  bin: string,
  label: string | undefined,
  startedAt: number,
  code: number | null,
  stderr: string
): void {
  const tail = stderr.trim().slice(-1000) || "(no stderr)"
  console.error(
    `[ffmpeg] ${processName(bin, label)} failed after ${Date.now() - startedAt}ms with exit ${code}: ${tail}`
  )
}

function logProcessError(
  bin: string,
  label: string | undefined,
  startedAt: number,
  err: Error
): void {
  console.error(
    `[ffmpeg] ${processName(bin, label)} errored after ${Date.now() - startedAt}ms:`,
    err
  )
}

function processName(bin: string, label: string | undefined): string {
  const base = label ? `${label} (${bin})` : bin
  return base
}
