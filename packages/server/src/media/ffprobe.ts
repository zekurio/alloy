import { t } from "@alloy/contracts/schema"

import { runProcess } from "./run-process"
import { transcodeSettings } from "./transcode-settings"

/** Probing reads container metadata only; anything slower is a wedged process. */
const PROBE_TIMEOUT_MS = 30_000

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

/** Run ffprobe on a file and return its parsed stream/format JSON. */
export async function runFfprobe(
  path: string,
  signal?: AbortSignal,
): Promise<FfprobeOutput> {
  const stdout: string[] = []
  await runProcess({
    name: "ffprobe",
    command: transcodeSettings().ffprobePath,
    args: [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      path,
    ],
    timeoutMs: PROBE_TIMEOUT_MS,
    signal,
    onStdoutLine: (line) => stdout.push(line),
  })
  const parsed = parseFfprobeJson(stdout.join("\n"))
  if (!parsed) throw new Error("ffprobe produced unparseable output")
  return parsed
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
