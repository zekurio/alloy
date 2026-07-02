import type {
  HardwareAcceleration,
  TranscodingConfig,
  VideoCodec,
} from "@alloy/contracts"
import {
  HARDWARE_ACCELERATIONS,
  TRANSCODE_VIDEO_CODECS,
} from "@alloy/contracts"

export interface TranscodeEncoder {
  codec: VideoCodec
  acceleration: HardwareAcceleration
  name: string
}

const ENCODER_MATRIX: Record<
  VideoCodec,
  Record<HardwareAcceleration, string | null>
> = {
  h264: {
    none: "libx264",
    nvenc: "h264_nvenc",
    qsv: "h264_qsv",
    vaapi: "h264_vaapi",
    videotoolbox: "h264_videotoolbox",
  },
  hevc: {
    none: "libx265",
    nvenc: "hevc_nvenc",
    qsv: "hevc_qsv",
    vaapi: "hevc_vaapi",
    videotoolbox: "hevc_videotoolbox",
  },
  av1: {
    none: "libsvtav1",
    nvenc: "av1_nvenc",
    qsv: "av1_qsv",
    vaapi: "av1_vaapi",
    videotoolbox: null,
  },
}

export function transcodeEncoder(
  codec: VideoCodec,
  acceleration: HardwareAcceleration,
): TranscodeEncoder | null {
  const name = ENCODER_MATRIX[codec][acceleration]
  if (!name) return null
  return { codec, acceleration, name }
}

export function transcodeEncoderMatrix(): TranscodeEncoder[] {
  const encoders: TranscodeEncoder[] = []
  for (const codec of TRANSCODE_VIDEO_CODECS) {
    for (const acceleration of HARDWARE_ACCELERATIONS) {
      const encoder = transcodeEncoder(codec, acceleration)
      if (encoder) encoders.push(encoder)
    }
  }
  return encoders
}

export function transcodeEncoderName(
  codec: VideoCodec,
  acceleration: HardwareAcceleration,
): string {
  return (
    transcodeEncoder(codec, acceleration)?.name ?? `${codec}_${acceleration}`
  )
}

export function buildEncoderGlobalArgs(config: TranscodingConfig): string[] {
  if (config.hardwareAcceleration !== "vaapi") return []
  return ["-vaapi_device", config.vaapiDevice]
}

export function buildVideoFilterChain(
  config: TranscodingConfig,
  filters: readonly string[],
): string {
  if (config.hardwareAcceleration !== "vaapi") return filters.join(",")
  return [...filters, "format=nv12", "hwupload"].join(",")
}

export function buildEncoderVideoArgs(options: {
  config: TranscodingConfig
  maxrateKbps?: number
}): string[] {
  const encoder = transcodeEncoder(
    options.config.videoCodec,
    options.config.hardwareAcceleration,
  )
  if (!encoder) {
    throw new Error(
      `No ${options.config.hardwareAcceleration} encoder for ${options.config.videoCodec}`,
    )
  }

  const args = encoderVideoQualityArgs(options.config, encoder)
  if (options.maxrateKbps === undefined) return args
  if (options.config.hardwareAcceleration === "vaapi") {
    return [
      ...args,
      "-b:v",
      `${options.maxrateKbps}k`,
      "-maxrate",
      `${options.maxrateKbps}k`,
      "-bufsize",
      `${Math.round(options.maxrateKbps * 1.5)}k`,
    ]
  }
  return [
    ...args,
    "-maxrate",
    `${options.maxrateKbps}k`,
    "-bufsize",
    `${Math.round(options.maxrateKbps * 1.5)}k`,
  ]
}

function encoderVideoQualityArgs(
  config: TranscodingConfig,
  encoder: TranscodeEncoder,
): string[] {
  if (encoder.acceleration === "none") {
    if (encoder.codec === "h264") {
      return [
        "-c:v",
        encoder.name,
        "-preset",
        "veryfast",
        "-crf",
        String(config.quality),
        "-pix_fmt",
        "yuv420p",
        "-sc_threshold",
        "0",
      ]
    }
    if (encoder.codec === "hevc") {
      return [
        "-c:v",
        encoder.name,
        "-preset",
        "veryfast",
        "-crf",
        String(config.quality),
        "-pix_fmt",
        "yuv420p",
        "-x265-params",
        "scenecut=0",
        "-tag:v",
        "hvc1",
      ]
    }
    return [
      "-c:v",
      encoder.name,
      "-preset",
      "8",
      "-crf",
      String(config.quality),
      "-pix_fmt",
      "yuv420p",
      "-svtav1-params",
      "scd=0",
    ]
  }

  if (encoder.acceleration === "nvenc") {
    return [
      "-c:v",
      encoder.name,
      "-preset",
      "p5",
      "-rc",
      "vbr",
      "-cq",
      String(config.quality),
      "-b:v",
      "0",
      "-pix_fmt",
      "yuv420p",
      ...(encoder.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
    ]
  }

  if (encoder.acceleration === "qsv") {
    return [
      "-c:v",
      encoder.name,
      "-preset",
      "veryfast",
      "-global_quality",
      String(config.quality),
      "-pix_fmt",
      "nv12",
      ...(encoder.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
    ]
  }

  if (encoder.acceleration === "vaapi") {
    return [
      "-c:v",
      encoder.name,
      "-rc_mode",
      "VBR",
      ...(encoder.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
    ]
  }

  return [
    "-c:v",
    encoder.name,
    "-q:v",
    String(
      Math.max(
        1,
        Math.min(100, Math.round(((51 - config.quality) * 100) / 51)),
      ),
    ),
    "-pix_fmt",
    "yuv420p",
    ...(encoder.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
  ]
}
