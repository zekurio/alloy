import type { EncoderCodec, HwaccelKind } from "../config/store"

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

export function buildRemuxArgs(
  srcPath: string,
  outPath: string,
  opts: {
    trimStartMs?: number | null
    trimEndMs?: number | null
  }
): string[] {
  const { trimSeek, trimDuration } = buildTrimArgs(opts)

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
  const { trimSeek, trimDuration } = buildTrimArgs(opts)

  const codecArgs = buildCodecArgs(config)
  const extraInputArgs = parseExtraArgs(config.extraInputArgs)
  const extraOutputArgs = parseExtraArgs(config.extraOutputArgs)
  const { videoFilter, remainingArgs: remainingExtraOutputArgs } =
    extractVideoFilterArgs(extraOutputArgs)
  const filterChain = videoFilter ?? buildFilterChain(opts.targetHeight, config)
  const hardwareArgs = buildHardwareArgs(config)
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
    ...remainingExtraOutputArgs,
    "-progress",
    "pipe:2",
    "-nostats",
    outPath,
  ]
}

function buildTrimArgs(opts: {
  trimStartMs?: number | null
  trimEndMs?: number | null
}): { trimSeek: string[]; trimDuration: string[] } {
  const hasTrim =
    opts.trimStartMs != null &&
    opts.trimEndMs != null &&
    opts.trimEndMs > opts.trimStartMs
  if (!hasTrim) return { trimSeek: [], trimDuration: [] }

  return {
    trimSeek: ["-ss", msToFfmpegTimestamp(opts.trimStartMs ?? 0)],
    trimDuration: [
      "-t",
      msToFfmpegTimestamp((opts.trimEndMs ?? 0) - (opts.trimStartMs ?? 0)),
    ],
  }
}

function buildHardwareArgs(config: ResolvedEncoderConfig): string[] {
  const hwaccel = config.hwaccel.trim()
  const encoder = config.encoder.trim()
  const args: string[] = []

  if (encoder.endsWith("_qsv") || hwaccel === "qsv") {
    args.push("-qsv_device", config.qsvDevice)
  }
  if (encoder.endsWith("_vaapi") || hwaccel === "vaapi") {
    args.push("-vaapi_device", config.vaapiDevice)
  }

  return args
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

function parseExtraArgs(raw: string): string[] {
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

function extractVideoFilterArgs(args: string[]): {
  videoFilter: string | null
  remainingArgs: string[]
} {
  let videoFilter: string | null = null
  const remainingArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) continue
    const inlineValue = videoFilterOptionInlineValue(arg)
    if (inlineValue != null) {
      videoFilter = unwrapFilterValue(inlineValue)
      continue
    }
    if (isVideoFilterOption(arg)) {
      const value = args[i + 1]
      if (value == null) {
        throw new Error(`Missing value for ffmpeg output option ${arg}`)
      }
      videoFilter = unwrapFilterValue(value)
      i += 1
      continue
    }
    remainingArgs.push(arg)
  }

  return { videoFilter, remainingArgs }
}

function unwrapFilterValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return value

  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1)
  }
  return value
}

function isVideoFilterOption(arg: string): boolean {
  return arg === "-vf" || arg === "-filter:v" || arg.startsWith("-filter:v:")
}

function videoFilterOptionInlineValue(arg: string): string | null {
  const equalsIndex = arg.indexOf("=")
  if (equalsIndex < 0) return null
  const option = arg.slice(0, equalsIndex)
  if (!isVideoFilterOption(option)) return null
  return arg.slice(equalsIndex + 1)
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
        // transcodes; libaom is about 10-50x slower for equivalent output.
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
