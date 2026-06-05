export { codecNameFor } from "./ffmpeg-codecs"
import { liveEncoderProfileFor } from "./ffmpeg-live-profiles"

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
  intelLowPowerH264: boolean
  intelLowPowerHevc: boolean
}

export interface LiveTranscodeOpts {
  config: ResolvedEncoderConfig
  targetHeight: number
  videoBitrate: number
  audioBitrate: number
}

interface EncodeOpts {
  config: ResolvedEncoderConfig
  targetHeight: number
}

/** Shared ffmpeg argument pieces for durable encodes. */
function buildEncodeParts(srcPath: string, opts: EncodeOpts) {
  const { config } = opts

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

  return {
    head: [
      "-hide_banner",
      "-y",
      ...hardwareArgs,
      ...extraInputArgs,
      "-i",
      srcPath,
      "-vf",
      filterChain,
      ...codecArgs,
    ],
    audioArgs,
    remainingExtraOutputArgs,
  }
}

export function buildEncodeArgs(
  srcPath: string,
  outPath: string,
  opts: EncodeOpts,
): string[] {
  const { head, audioArgs, remainingExtraOutputArgs } = buildEncodeParts(
    srcPath,
    opts,
  )

  return [
    ...head,
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

export function buildLiveTranscodeArgs(
  srcPath: string,
  opts: LiveTranscodeOpts,
): string[] {
  const { config } = opts
  const encoder = config.encoder.trim()
  const liveProfile = liveEncoderProfileFor(encoder)
  const hardwareArgs = buildHardwareArgs(config)
  const filterChain = buildFilterChain(opts.targetHeight, config)
  const bitrate = String(
    Math.max(liveProfile.minBitrate, Math.round(opts.videoBitrate)),
  )
  const audioBitrate = String(Math.max(32_000, Math.round(opts.audioBitrate)))

  return [
    "-hide_banner",
    "-nostdin",
    ...hardwareArgs,
    "-i",
    srcPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-sn",
    "-dn",
    "-vf",
    filterChain,
    ...(encoder ? ["-c:v", encoder] : []),
    ...lowPowerArgs(config),
    ...liveProfile.presetArgs(config.preset),
    ...liveProfile.bitrateArgs(bitrate, String(config.quality)),
    ...liveProfile.mp4Args,
    "-c:a",
    "aac",
    "-b:a",
    audioBitrate,
    "-ac",
    "2",
    "-ar",
    "48000",
    "-movflags",
    "+frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  ]
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
  config: ResolvedEncoderConfig,
): string {
  const height = evenTargetHeight(targetHeight)
  const scale = `scale=-2:${height}:force_original_aspect_ratio=decrease`
  if (config.encoder.trim().endsWith("_vaapi")) {
    return `${scale},format=nv12,hwupload_vaapi`
  }
  return `${scale},format=yuv420p`
}

function evenTargetHeight(targetHeight: number): number {
  const rounded = Math.floor(targetHeight)
  const even = rounded % 2 === 0 ? rounded : rounded - 1
  return Math.max(2, even)
}

function buildCodecArgs(config: ResolvedEncoderConfig): string[] {
  const q = String(config.quality)
  const presetArgs = config.preset ? ["-preset", config.preset] : []
  const encoder = config.encoder.trim()
  if (!encoder) return []

  return [
    "-c:v",
    encoder,
    ...lowPowerArgs(config),
    ...presetArgs,
    ...qualityArgsForEncoder(encoder, q),
  ]
}

function lowPowerArgs(config: ResolvedEncoderConfig): string[] {
  const encoder = config.encoder.trim()
  if (encoder === "h264_qsv" && config.intelLowPowerH264) {
    return ["-low_power", "1"]
  }
  if (encoder === "hevc_qsv" && config.intelLowPowerHevc) {
    return ["-low_power", "1"]
  }
  return []
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
  if (encoder.endsWith("_nvenc")) {
    return ["-rc", "vbr", "-cq", quality, "-b:v", "0"]
  }
  if (encoder.endsWith("_qsv")) return ["-global_quality", quality]
  if (encoder.endsWith("_amf")) {
    return ["-rc", "cqp", "-qp_i", quality, "-qp_p", quality]
  }
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
