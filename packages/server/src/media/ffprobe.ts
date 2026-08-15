import { spawn } from "node:child_process"

import { t } from "@alloy/contracts/schema"

import { transcodeSettings } from "./transcode-settings"

/** Probing reads container metadata only; anything slower is a wedged process. */
const PROBE_TIMEOUT_MS = 30_000

/** Grace period between SIGTERM and SIGKILL when stopping a stuck process. */
const KILL_GRACE_MS = 5_000

const FfprobeRecordSchema = t.record(t.string(), t.unknown())
const FfprobeInputSchema = t.object({
  format: FfprobeRecordSchema.catch({}).$default({}),
  streams: t.array(t.unknown()).catch([]).$default([]),
})
const FfprobeStringSchema = t.string()
const FfprobeNumberSchema = t.number().refine(Number.isFinite)

type FfprobeField = t.infer<typeof FfprobeRecordSchema>[string]

export interface FfprobeStream {
  /** Absolute container stream index, matching ffmpeg's `0:<index>` map. */
  index: number
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
  start_time?: string
}

export interface FfprobeOutput {
  streams: FfprobeStream[]
  format: { duration?: string; start_time?: string }
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
  let value: Parameters<typeof FfprobeInputSchema.safeParse>[0]
  try {
    value = JSON.parse(stdout)
  } catch {
    return null
  }
  const parsed = FfprobeInputSchema.safeParse(value)
  if (!parsed.success) return null
  return {
    streams: parsed.data.streams.flatMap((stream) => {
      const streamRecord = FfprobeRecordSchema.safeParse(stream)
      if (!streamRecord.success) return []
      return [
        {
          index: numberField(streamRecord.data.index) ?? -1,
          codec_type: stringField(streamRecord.data.codec_type) ?? "",
          codec_name: stringField(streamRecord.data.codec_name) ?? "",
          codec_tag_string:
            stringField(streamRecord.data.codec_tag_string) ?? "",
          width: numberField(streamRecord.data.width),
          height: numberField(streamRecord.data.height),
          profile: stringField(streamRecord.data.profile),
          level: numberField(streamRecord.data.level),
          avg_frame_rate: stringField(streamRecord.data.avg_frame_rate),
          pix_fmt: stringField(streamRecord.data.pix_fmt),
          start_time: stringField(streamRecord.data.start_time),
        },
      ]
    }),
    format: {
      duration: stringField(parsed.data.format.duration),
      start_time: stringField(parsed.data.format.start_time),
    },
  }
}

function stringField(value: FfprobeField): string | undefined {
  const parsed = FfprobeStringSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function numberField(value: FfprobeField): number | undefined {
  const parsed = FfprobeNumberSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
