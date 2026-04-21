import { spawn } from "node:child_process"

export interface CaptureResult {
  stdout: string
  stderr: string
}

export function runCapture(
  bin: string,
  args: ReadonlyArray<string>
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
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
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
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
        resolve()
      } else {
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
