import type { EncoderCodec, HwaccelKind } from "../config/store"
import { env } from "../env"
import { runCapture, runWithProgress } from "./ffmpeg-process"

export interface ProbeResult {
  durationMs: number
  width: number
  height: number
  /** Best-effort MIME from the container. Caller should still trust the
   * stored Content-Type when present. */
  contentType: string
  videoCodec: string
  audioCodec: string | null
}

export interface ResolvedEncoderConfig {
  hwaccel: string
  encoder: string
  quality: number
  preset?: string
  audioBitrateKbps: number
  extraInputArgs: string
  extraOutputArgs: string
  qsvDevice: string
  vaapiDevice: string
}

/**
 * ffprobe the file and pull the dimensions, duration, and a best-effort
 * content type. Throws on non-zero exit or unparsable output.
 */
export async function probe(srcPath: string): Promise<ProbeResult> {
  const { stdout } = await runCapture(env.FFPROBE_BIN, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    srcPath,
  ])

  let parsed: ProbeJson
  try {
    parsed = JSON.parse(stdout) as ProbeJson
  } catch (err) {
    throw new Error(`ffprobe returned unparsable JSON: ${err}`)
  }

  const videoStream = parsed.streams?.find((s) => s.codec_type === "video")
  if (!videoStream) throw new Error("No video stream found")
  const audioStream = parsed.streams?.find((s) => s.codec_type === "audio")

  // Duration sometimes only appears at the format level (mkv/mp4 with
  // unknown stream duration). Fall back through both.
  const durationSec = Number.parseFloat(
    videoStream.duration ?? parsed.format?.duration ?? "0"
  )
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Could not determine duration from probe output")
  }

  const width = Number.parseInt(String(videoStream.width ?? 0), 10)
  const height = Number.parseInt(String(videoStream.height ?? 0), 10)
  if (!width || !height) throw new Error("Missing width/height in probe output")

  return {
    durationMs: Math.round(durationSec * 1000),
    width,
    height,
    contentType: contentTypeForFormatName(parsed.format?.format_name ?? ""),
    videoCodec: String(videoStream.codec_name ?? "").toLowerCase(),
    audioCodec: audioStream?.codec_name
      ? String(audioStream.codec_name).toLowerCase()
      : null,
  }
}

interface ProbeJson {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number | string
    height?: number | string
    duration?: string
  }>
  format?: {
    format_name?: string
    duration?: string
  }
}

function contentTypeForFormatName(name: string): string {
  // Container detection from ffprobe's `format_name` (comma-separated).
  const parts = name.split(",").map((s) => s.trim())
  if (parts.includes("mp4") || parts.includes("mov")) return "video/mp4"
  if (parts.includes("matroska")) return "video/x-matroska"
  if (parts.includes("webm")) return "video/webm"
  return "application/octet-stream"
}

export async function encode(
  srcPath: string,
  outPath: string,
  opts: {
    config: ResolvedEncoderConfig
    targetHeight: number
    durationMs: number
    onProgress: (pct: number) => void
    trimStartMs?: number | null
    trimEndMs?: number | null
    signal?: AbortSignal
  }
): Promise<void> {
  const args = buildEncodeArgs(srcPath, outPath, opts)

  await runWithProgress(
    env.FFMPEG_BIN,
    args,
    (line) => {
      const m =
        /^out_time_us=(-?\d+)/m.exec(line) ?? /^out_time_ms=(-?\d+)/m.exec(line)
      if (!m) return
      const microseconds = Number.parseInt(m[1] ?? "0", 10)
      if (!Number.isFinite(microseconds) || microseconds < 0) return
      const ms = microseconds / 1000
      const pct = Math.min(
        99,
        Math.max(0, Math.floor((ms / opts.durationMs) * 100))
      )
      opts.onProgress(pct)
    },
    opts.signal
  )
}

export async function remuxToMp4(
  srcPath: string,
  outPath: string,
  opts: {
    trimStartMs?: number | null
    trimEndMs?: number | null
    signal?: AbortSignal
  }
): Promise<void> {
  await runWithProgress(
    env.FFMPEG_BIN,
    buildRemuxArgs(srcPath, outPath, opts),
    () => undefined,
    opts.signal
  )
}

export function buildRemuxArgs(
  srcPath: string,
  outPath: string,
  opts: {
    trimStartMs?: number | null
    trimEndMs?: number | null
  }
): string[] {
  const hasTrim =
    opts.trimStartMs != null &&
    opts.trimEndMs != null &&
    opts.trimEndMs > opts.trimStartMs
  const trimSeek: string[] = hasTrim
    ? ["-ss", msToFfmpegTimestamp(opts.trimStartMs ?? 0)]
    : []
  const trimDuration: string[] = hasTrim
    ? [
        "-t",
        msToFfmpegTimestamp((opts.trimEndMs ?? 0) - (opts.trimStartMs ?? 0)),
      ]
    : []

  return [
    "-hide_banner",
    "-y",
    ...trimSeek,
    "-i",
    srcPath,
    ...trimDuration,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "-avoid_negative_ts",
    "make_zero",
    outPath,
  ]
}

export function buildEncodeArgs(
  srcPath: string,
  outPath: string,
  opts: {
    config: ResolvedEncoderConfig
    targetHeight: number
    trimStartMs?: number | null
    trimEndMs?: number | null
  }
): string[] {
  const { config } = opts
  const hasTrim =
    opts.trimStartMs != null &&
    opts.trimEndMs != null &&
    opts.trimEndMs > opts.trimStartMs
  const trimSeek: string[] = hasTrim
    ? ["-ss", msToFfmpegTimestamp(opts.trimStartMs ?? 0)]
    : []
  const trimDuration: string[] = hasTrim
    ? [
        "-t",
        msToFfmpegTimestamp((opts.trimEndMs ?? 0) - (opts.trimStartMs ?? 0)),
      ]
    : []

  const filterChain = buildFilterChain(opts.targetHeight, config)
  const codecArgs = buildCodecArgs(config)
  const hardwareArgs = buildHardwareArgs(config)
  const extraInputArgs = parseExtraArgs(config.extraInputArgs)
  const extraOutputArgs = parseExtraArgs(config.extraOutputArgs)
  const audioArgs = [
    "-c:a",
    "aac",
    "-b:a",
    `${config.audioBitrateKbps}k`,
    "-ac",
    "2",
    "-ar",
    "48000",
  ]

  return [
    "-hide_banner",
    "-y",
    ...trimSeek,
    ...hardwareArgs,
    ...extraInputArgs,
    "-i",
    srcPath,
    ...trimDuration,
    "-vf",
    filterChain,
    ...codecArgs,
    "-movflags",
    "+faststart",
    ...audioArgs,
    ...extraOutputArgs,
    "-progress",
    "pipe:2",
    "-nostats",
    outPath,
  ]
}

function buildHardwareArgs(config: ResolvedEncoderConfig): string[] {
  const hwaccel = config.hwaccel.trim()
  const encoder = config.encoder.trim()
  const ffmpegHwaccel = ffmpegHwaccelName(hwaccel)
  const args = ffmpegHwaccel ? ["-hwaccel", ffmpegHwaccel] : []

  if (encoder.endsWith("_qsv") || hwaccel === "qsv") {
    args.push("-qsv_device", config.qsvDevice)
  }
  if (encoder.endsWith("_vaapi") || hwaccel === "vaapi") {
    args.push("-vaapi_device", config.vaapiDevice)
  }

  return args
}

function ffmpegHwaccelName(hwaccel: string): string {
  if (hwaccel === "none") return ""
  if (hwaccel === "nvenc") return "cuda"
  return hwaccel
}

function buildFilterChain(
  targetHeight: number,
  config: ResolvedEncoderConfig
): string {
  const scale = `scale=-2:${targetHeight}:force_original_aspect_ratio=decrease`
  if (config.encoder.trim().endsWith("_vaapi")) {
    return `${scale},format=nv12,hwupload`
  }
  return `${scale},format=yuv420p`
}

function buildCodecArgs(config: ResolvedEncoderConfig): string[] {
  const q = String(config.quality)
  const presetArgs = config.preset ? ["-preset", config.preset] : []
  const encoder = config.encoder.trim()
  if (!encoder) return []

  return ["-c:v", encoder, ...presetArgs, ...qualityArgsForEncoder(encoder, q)]
}

function qualityArgsForEncoder(encoder: string, quality: string): string[] {
  if (encoder === "libx264") {
    return [
      "-crf",
      quality,
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p",
    ]
  }
  if (encoder === "libx265" || encoder === "libsvtav1") {
    return ["-crf", quality, "-pix_fmt", "yuv420p"]
  }
  if (encoder.endsWith("_nvenc"))
    return ["-rc", "vbr", "-cq", quality, "-b:v", "0"]
  if (encoder.endsWith("_qsv")) return ["-global_quality", quality]
  if (encoder.endsWith("_amf"))
    return ["-rc", "cqp", "-qp_i", quality, "-qp_p", quality]
  if (encoder.endsWith("_vaapi")) return ["-qp", quality]
  return []
}

export function parseExtraArgs(raw: string): string[] {
  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaping = false

  for (const char of raw) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === "\\") {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current)
        current = ""
      }
      continue
    }
    current += char
  }

  if (escaping) current += "\\"
  if (quote) throw new Error("Unclosed quote in ffmpeg extra args")
  if (current.length > 0) args.push(current)
  return args
}

export function codecNameFor(
  hwaccel: HwaccelKind,
  codec: EncoderCodec
): string {
  if (hwaccel === "none") {
    switch (codec) {
      case "h264":
        return "libx264"
      case "hevc":
        return "libx265"
      case "av1":
        // SVT-AV1 is the only sane software AV1 option for server
        // transcodes — libaom is ~10–50× slower for equivalent output.
        return "libsvtav1"
    }
  }
  return `${codec}_${hwaccel}`
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
