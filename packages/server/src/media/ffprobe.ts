import { spawn } from "node:child_process"

import { transcodeSettings } from "./transcode-settings"

/** Probing reads container metadata only; anything slower is a wedged process. */
const PROBE_TIMEOUT_MS = 30_000

/** Grace period between SIGTERM and SIGKILL when stopping a stuck process. */
const KILL_GRACE_MS = 5_000

export interface FfprobeStream {
  codec_type: string
  codec_name: string
  codec_tag_string: string
  width?: number
  height?: number
  profile?: string
  level?: number
  /** Fraction string like "30/1" or "24000/1001"; "0/0" when unknown. */
  avg_frame_rate?: string
  pix_fmt?: string
}

export interface FfprobeOutput {
  streams: FfprobeStream[]
  format: { duration?: string }
}

export class FfprobeError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
  ) {
    super(message)
    this.name = "FfprobeError"
  }
}

/** Run ffprobe on a file and return its parsed stream/format JSON. */
export function runFfprobe(
  path: string,
  signal?: AbortSignal,
): Promise<FfprobeOutput> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"))
  }

  const ffprobePath = transcodeSettings().ffprobePath
  const child = spawn(
    ffprobePath,
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      path,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  )

  let stdout = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk
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
  }, PROBE_TIMEOUT_MS)
  const onAbort = () => {
    aborted = true
    stop()
  }
  signal?.addEventListener("abort", onAbort, { once: true })

  return new Promise<FfprobeOutput>((resolve, reject) => {
    child.once("error", (err) => {
      reject(
        new FfprobeError(
          `Failed to start ffprobe (${ffprobePath}): ${err.message}`,
          null,
        ),
      )
    })
    child.once("close", (code) => {
      if (aborted) {
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      if (timedOut) {
        reject(new FfprobeError("ffprobe timed out", code))
        return
      }
      if (code !== 0) {
        reject(new FfprobeError(`ffprobe exited with code ${code}`, code))
        return
      }
      const parsed = parseFfprobeJson(stdout)
      if (!parsed) {
        reject(new FfprobeError("ffprobe produced unparseable output", code))
        return
      }
      resolve(parsed)
    })
  }).finally(() => {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", onAbort)
  })
}

function parseFfprobeJson(stdout: string): FfprobeOutput | null {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const format =
    typeof record.format === "object" && record.format !== null
      ? (record.format as Record<string, unknown>)
      : {}
  const streams = Array.isArray(record.streams) ? record.streams : []
  return {
    streams: streams
      .filter(
        (stream): stream is Record<string, unknown> =>
          typeof stream === "object" && stream !== null,
      )
      .map((stream) => ({
        codec_type: stringField(stream.codec_type) ?? "",
        codec_name: stringField(stream.codec_name) ?? "",
        codec_tag_string: stringField(stream.codec_tag_string) ?? "",
        width: numberField(stream.width),
        height: numberField(stream.height),
        profile: stringField(stream.profile),
        level: numberField(stream.level),
        avg_frame_rate: stringField(stream.avg_frame_rate),
        pix_fmt: stringField(stream.pix_fmt),
      })),
    format: { duration: stringField(format.duration) },
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
