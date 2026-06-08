import { env } from "../env"
import { runCapture } from "./ffmpeg-process"

interface ProbeResult {
  durationMs: number
  width: number
  height: number
  /** Best-effort MIME from the container. Caller should still trust the
   * stored Content-Type when present. */
  contentType: string
  videoCodec: string
  audioCodec: string | null
  color: VideoColorInfo
}

export interface VideoColorInfo {
  primaries: string | null
  transfer: string | null
  space: string | null
  range: string | null
  isHdr: boolean
}

/**
 * ffprobe the file and pull the dimensions, duration, and a best-effort
 * content type. Throws on non-zero exit or unparsable output.
 */
export async function probe(srcPath: string): Promise<ProbeResult> {
  const { stdout } = await runCapture(
    env.FFPROBE_BIN,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      srcPath,
    ],
    { label: "probe" },
  )

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
    videoStream.duration ?? parsed.format?.duration ?? "0",
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
    color: videoColorInfo(videoStream),
  }
}

interface ProbeJson {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number | string
    height?: number | string
    duration?: string
    color_primaries?: string
    color_transfer?: string
    color_space?: string
    color_range?: string
  }>
  format?: {
    format_name?: string
    duration?: string
  }
}

function videoColorInfo(
  stream: NonNullable<ProbeJson["streams"]>[number],
): VideoColorInfo {
  const primaries = normalizeColorValue(stream.color_primaries)
  const transfer = normalizeColorValue(stream.color_transfer)
  const space = normalizeColorValue(stream.color_space)
  const range = normalizeColorValue(stream.color_range)
  return {
    primaries,
    transfer,
    space,
    range,
    isHdr: isHdrColor({ primaries, transfer, space }),
  }
}

function normalizeColorValue(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized || normalized === "unknown" || normalized === "reserved") {
    return null
  }
  return normalized
}

function isHdrColor(input: {
  primaries: string | null
  transfer: string | null
  space: string | null
}): boolean {
  return (
    input.transfer === "smpte2084" ||
    input.transfer === "arib-std-b67" ||
    input.primaries === "bt2020" ||
    input.space === "bt2020nc" ||
    input.space === "bt2020c"
  )
}

function contentTypeForFormatName(name: string): string {
  // Container detection from ffprobe's `format_name` (comma-separated).
  const parts = name.split(",").map((s) => s.trim())
  if (parts.includes("mp4") || parts.includes("mov")) return "video/mp4"
  if (parts.includes("matroska")) return "video/x-matroska"
  if (parts.includes("webm")) return "video/webm"
  return "application/octet-stream"
}
