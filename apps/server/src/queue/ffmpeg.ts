import type {
  EncoderCodec,
  EncoderConfig,
  HwaccelKind,
} from "../lib/config-store"
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
    config: EncoderConfig
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

export function buildEncodeArgs(
  srcPath: string,
  outPath: string,
  opts: {
    config: EncoderConfig
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

  const deviceInit: string[] = (() => {
    switch (config.hwaccel) {
      case "vaapi":
        return ["-vaapi_device", config.vaapiDevice]
      case "qsv":
        return ["-init_hw_device", "qsv=qsv:hw", "-filter_hw_device", "qsv"]
      default:
        return []
    }
  })()

  const filterChain = buildFilterChain(config, opts.targetHeight)
  const codecArgs = buildCodecArgs(config)
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
    ...deviceInit,
    ...trimSeek,
    "-i",
    srcPath,
    ...trimDuration,
    "-vf",
    filterChain,
    ...codecArgs,
    "-movflags",
    "+faststart",
    ...audioArgs,
    "-progress",
    "pipe:2",
    "-nostats",
    outPath,
  ]
}

function buildFilterChain(config: EncoderConfig, targetHeight: number): string {
  const scale = `scale=-2:${targetHeight}:force_original_aspect_ratio=decrease`
  switch (config.hwaccel) {
    case "vaapi":
      // VAAPI scaler runs on the GPU once frames are uploaded in nv12.
      return `format=nv12,hwupload,scale_vaapi=-2:${targetHeight}`
    case "qsv":
      // The QSV scaler runs on the iGPU; uploading first lets us scale
      // and encode without round-tripping back through system memory.
      return `${scale},hwupload=extra_hw_frames=64,format=qsv`
    case "software":
    case "nvenc":
    case "amf":
      // libx264/x265 wants yuv420p; NVENC + AMF accept it directly. The
      // explicit format ensures consistent output regardless of source.
      return `${scale},format=yuv420p`
  }
}

function buildCodecArgs(config: EncoderConfig): string[] {
  const q = String(config.quality)
  const preset = config.preset
  const codecName = codecNameFor(config.hwaccel, config.codec)

  switch (config.hwaccel) {
    case "software":
      return [
        "-c:v",
        codecName,
        "-preset",
        preset,
        "-crf",
        q,
        ...softwareCodecTail(config.codec),
      ]
    case "nvenc":
      return [
        "-c:v",
        codecName,
        "-preset",
        preset,
        "-rc",
        "vbr",
        "-cq",
        q,
        "-b:v",
        "0",
      ]
    case "qsv":
      return ["-c:v", codecName, "-preset", preset, "-global_quality", q]
    case "amf":
      return [
        "-c:v",
        codecName,
        "-quality",
        preset,
        "-rc",
        "cqp",
        "-qp_i",
        q,
        "-qp_p",
        q,
      ]
    case "vaapi":
      // VAAPI ignores the preset string — the API just doesn't expose
      // one. We feed `qp` directly. (admins still set a preset value
      // because the schema requires one; we just don't emit it.)
      return ["-c:v", codecName, "-qp", q]
  }
}

function softwareCodecTail(codec: EncoderCodec): string[] {
  switch (codec) {
    case "h264":
      return ["-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p"]
    case "hevc":
    case "av1":
      return ["-pix_fmt", "yuv420p"]
  }
}

export function codecNameFor(
  hwaccel: HwaccelKind,
  codec: EncoderCodec
): string {
  if (hwaccel === "software") {
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
