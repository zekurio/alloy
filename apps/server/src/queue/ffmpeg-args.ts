import type { EncoderTonemappingConfig } from "@workspace/contracts"

export { codecNameFor } from "./ffmpeg-codecs"
import { liveEncoderProfileFor } from "./ffmpeg-live-profiles"

export interface SourceColorInfo {
  primaries: string | null
  transfer: string | null
  space: string | null
  range: string | null
  isHdr: boolean
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
  intelLowPowerH264: boolean
  intelLowPowerHevc: boolean
  tonemapping: EncoderTonemappingConfig
  sourceColor?: SourceColorInfo
}

export interface LiveTranscodeOpts {
  config: ResolvedEncoderConfig
  targetHeight: number
  videoBitrate: number
  audioBitrate: number
}

export interface LiveHlsOpts extends LiveTranscodeOpts {
  segmentLengthSec: number
  startNumber: number
  startTimeSec: number
  segmentPattern: string
  initFilename: string
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
  return [
    ...buildLiveOutputHead(srcPath, opts),
    "-movflags",
    "+frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  ]
}

export function buildLiveHlsArgs(
  srcPath: string,
  playlistPath: string,
  opts: LiveHlsOpts,
): string[] {
  const segmentLength = String(Math.max(1, Math.floor(opts.segmentLengthSec)))
  const startNumber = Math.max(0, Math.floor(opts.startNumber))
  return [
    ...buildLiveOutputHead(srcPath, opts),
    // -copyts keeps source timestamps so a job resumed mid-stream (-ss on a
    // later segment) emits PTS at the segment's real time instead of 0; without
    // it hls.js places restarted segments at the wrong spot and stalls. The
    // forced-keyframe schedule is offset by startNumber so cut points stay on
    // absolute segment boundaries once timestamps are no longer zero-based.
    "-copyts",
    "-avoid_negative_ts",
    "disabled",
    "-force_key_frames",
    `expr:gte(t,(n_forced+${startNumber})*${segmentLength})`,
    "-f",
    "hls",
    "-max_delay",
    "5000000",
    "-hls_time",
    segmentLength,
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    opts.initFilename,
    "-start_number",
    String(startNumber),
    "-hls_segment_filename",
    opts.segmentPattern,
    "-hls_playlist_type",
    "vod",
    "-hls_list_size",
    "0",
    "-hls_segment_options",
    "movflags=+frag_discont",
    "-y",
    playlistPath,
  ]
}

function buildLiveOutputHead(
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
    ...(optsHasStart(opts) ? ["-ss", String(opts.startTimeSec)] : []),
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
  ]
}

function optsHasStart(
  opts: LiveTranscodeOpts | LiveHlsOpts,
): opts is LiveHlsOpts {
  return "startTimeSec" in opts && opts.startTimeSec > 0
}

function buildHardwareArgs(config: ResolvedEncoderConfig): string[] {
  const hwaccel = config.hwaccel.trim()
  const encoder = config.encoder.trim()
  const args: string[] = []

  if (shouldTonemap(config) && !shouldUseQsvVppTonemapping(config)) {
    args.push("-init_hw_device", "opencl=ocl", "-filter_hw_device", "ocl")
  }
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
  if (shouldUseQsvVppTonemapping(config)) {
    return buildQsvVppTonemappingFilter(height, config)
  }
  const toneMap = buildTonemappingFilter(config)
  if (config.encoder.trim().endsWith("_vaapi")) {
    return [toneMap, scale, "format=nv12", "hwupload_vaapi"]
      .filter((part): part is string => Boolean(part))
      .join(",")
  }
  return [toneMap, scale, "format=yuv420p"]
    .filter((part): part is string => Boolean(part))
    .join(",")
}

function buildQsvVppTonemappingFilter(
  height: number,
  config: ResolvedEncoderConfig,
): string {
  const vpp = config.tonemapping.vpp
  const options = [
    "w=-1",
    `h=${height}`,
    "format=nv12",
    "tonemap=1",
    "procamp=1",
    `brightness=${formatFilterNumber(vpp.brightness)}`,
    `contrast=${formatFilterNumber(vpp.contrast)}`,
    "out_color_matrix=bt709",
    "out_color_primaries=bt709",
    "out_color_transfer=bt709",
  ]
  return [
    sourceHdrSetParams(config.sourceColor ?? fallbackHdrColor),
    "format=nv12",
    "hwupload=extra_hw_frames=16",
    "format=qsv",
    `vpp_qsv=${options.join(":")}`,
  ].join(",")
}

function buildTonemappingFilter(config: ResolvedEncoderConfig): string | null {
  const toneMapping = config.tonemapping
  const sourceColor = config.sourceColor
  if (!toneMapping.enabled || !sourceColor?.isHdr) return null

  const options = [
    "format=yuv420p",
    "p=bt709",
    "t=bt709",
    "m=bt709",
    `tonemap=${toneMapping.algorithm}`,
    `tonemap_mode=${toneMapping.mode}`,
    `peak=${formatFilterNumber(toneMapping.peak)}`,
    `desat=${formatFilterNumber(toneMapping.desat)}`,
    `threshold=${formatFilterNumber(toneMapping.threshold)}`,
    toneMapping.param === null
      ? null
      : `param=${formatFilterNumber(toneMapping.param)}`,
    toneMapping.range === "auto" ? null : `r=${toneMapping.range}`,
  ].filter((option): option is string => option !== null)

  return [
    sourceHdrSetParams(sourceColor),
    "format=p010le",
    "hwupload",
    `tonemap_opencl=${options.join(":")}`,
    "hwdownload",
    "format=yuv420p",
  ].join(",")
}

function shouldTonemap(config: ResolvedEncoderConfig): boolean {
  return Boolean(config.tonemapping.enabled && config.sourceColor?.isHdr)
}

function shouldUseQsvVppTonemapping(config: ResolvedEncoderConfig): boolean {
  return Boolean(
    shouldTonemap(config) &&
    config.tonemapping.vpp.enabled &&
    config.encoder.trim().endsWith("_qsv"),
  )
}

const fallbackHdrColor: SourceColorInfo = {
  primaries: "bt2020",
  transfer: "smpte2084",
  space: "bt2020nc",
  range: null,
  isHdr: true,
}

function sourceHdrSetParams(color: SourceColorInfo): string {
  const primaries = color.primaries ?? "bt2020"
  const transfer = color.transfer ?? "smpte2084"
  const space = color.space ?? "bt2020nc"
  return `setparams=color_primaries=${primaries}:color_trc=${transfer}:colorspace=${space}`
}

function formatFilterNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(value)
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
