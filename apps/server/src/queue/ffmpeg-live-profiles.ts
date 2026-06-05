export interface LiveEncoderProfile {
  minBitrate: number
  presetArgs: (configuredPreset: string | undefined) => string[]
  bitrateArgs: (bitrate: string, quality: string) => string[]
  mp4Args: string[]
}

const DEFAULT_LIVE_MIN_BITRATE = 100_000
const HEVC_MP4_TAG_ARGS = ["-tag:v", "hvc1"]
const NO_ARGS: string[] = []

export function liveEncoderProfileFor(encoder: string): LiveEncoderProfile {
  if (encoder === "libx264") return libx264LiveProfile()
  if (encoder === "libx265") return libx265LiveProfile()
  if (encoder === "libsvtav1") return libsvtav1LiveProfile()
  if (encoder.endsWith("_qsv")) return qsvLiveProfile(encoder)
  if (encoder.endsWith("_vaapi")) return vaapiLiveProfile(encoder)
  if (encoder.endsWith("_nvenc")) return nvencLiveProfile(encoder)
  if (encoder === "av1_amf") return av1AmfLiveProfile()
  if (encoder === "h264_amf" || encoder === "hevc_amf") {
    return amfLiveProfile(encoder)
  }
  if (encoder.endsWith("_rkmpp") || encoder.endsWith("_v4l2m2m")) {
    return simpleLiveProfile(encoder)
  }
  if (encoder === "h264_videotoolbox" || encoder === "hevc_videotoolbox") {
    return videotoolboxLiveProfile(encoder)
  }
  return simpleLiveProfile(encoder)
}

function baseLiveProfile(
  encoder: string,
  overrides: Partial<LiveEncoderProfile>,
): LiveEncoderProfile {
  return {
    minBitrate: DEFAULT_LIVE_MIN_BITRATE,
    presetArgs: () => NO_ARGS,
    bitrateArgs: liveBitrateBufferArgs,
    mp4Args: hevcMp4Args(encoder),
    ...overrides,
  }
}

function libx264LiveProfile(): LiveEncoderProfile {
  return baseLiveProfile("libx264", {
    presetArgs: livePreset("veryfast"),
    bitrateArgs: (bitrate) => [
      ...liveBitrateBufferArgs(bitrate),
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p",
    ],
    mp4Args: NO_ARGS,
  })
}

function libx265LiveProfile(): LiveEncoderProfile {
  return baseLiveProfile("libx265", {
    presetArgs: livePreset("veryfast"),
    bitrateArgs: (bitrate) => [
      ...liveBitrateBufferArgs(bitrate),
      "-pix_fmt",
      "yuv420p",
      "-x265-params",
      "no-scenecut=1:no-open-gop=1:no-info=1",
      "-bf",
      "0",
    ],
  })
}

function libsvtav1LiveProfile(): LiveEncoderProfile {
  return baseLiveProfile("libsvtav1", {
    presetArgs: livePreset("10"),
    bitrateArgs: (bitrate, quality) => [
      "-crf",
      liveAv1Crf(quality),
      "-maxrate",
      bitrate,
      "-bufsize",
      String(Number(bitrate) * 2),
      "-pix_fmt",
      "yuv420p",
    ],
    mp4Args: NO_ARGS,
  })
}

function qsvLiveProfile(encoder: string): LiveEncoderProfile {
  return baseLiveProfile(encoder, {
    minBitrate: encoder === "h264_qsv" ? 1_000_000 : DEFAULT_LIVE_MIN_BITRATE,
    presetArgs: livePreset("veryfast"),
    bitrateArgs: (bitrate) => [
      ...(encoder === "h264_qsv" || encoder === "hevc_qsv"
        ? ["-mbbrc", "1"]
        : []),
      "-b:v",
      bitrate,
      "-maxrate",
      String(Number(bitrate) + 1),
      "-rc_init_occupancy",
      bitrate,
      "-bufsize",
      String(Number(bitrate) * 2),
    ],
  })
}

function vaapiLiveProfile(encoder: string): LiveEncoderProfile {
  return baseLiveProfile(encoder, {
    bitrateArgs: (bitrate) => [
      "-rc_mode",
      "VBR",
      ...liveBitrateBufferArgs(bitrate),
    ],
  })
}

function nvencLiveProfile(encoder: string): LiveEncoderProfile {
  return baseLiveProfile(encoder, {
    presetArgs: livePreset("p1"),
    bitrateArgs: (bitrate) => ["-rc", "vbr", ...liveBitrateBufferArgs(bitrate)],
  })
}

function av1AmfLiveProfile(): LiveEncoderProfile {
  return baseLiveProfile("av1_amf", {
    presetArgs: () => ["-quality", "speed", "-header_insertion_mode", "gop"],
    mp4Args: NO_ARGS,
  })
}

function amfLiveProfile(encoder: string): LiveEncoderProfile {
  return baseLiveProfile(encoder, {
    presetArgs: () => [
      "-quality",
      "speed",
      ...(encoder === "hevc_amf"
        ? ["-header_insertion_mode", "gop", "-gops_per_idr", "1"]
        : []),
    ],
    bitrateArgs: (bitrate) => [
      "-rc",
      "cbr",
      "-qmin",
      "0",
      "-qmax",
      "32",
      ...liveBitrateBufferArgs(bitrate),
    ],
  })
}

function simpleLiveProfile(encoder: string): LiveEncoderProfile {
  return baseLiveProfile(encoder, {})
}

function videotoolboxLiveProfile(encoder: string): LiveEncoderProfile {
  return baseLiveProfile(encoder, {
    presetArgs: () => ["-prio_speed", "1"],
    bitrateArgs: (bitrate) => ["-b:v", bitrate, "-qmin", "-1", "-qmax", "-1"],
  })
}

function livePreset(defaultPreset: string) {
  return (configuredPreset: string | undefined): string[] => {
    const preset = configuredPreset?.trim() || defaultPreset
    return preset ? ["-preset", preset] : NO_ARGS
  }
}

function liveBitrateBufferArgs(bitrate: string): string[] {
  return [
    "-b:v",
    bitrate,
    "-maxrate",
    bitrate,
    "-bufsize",
    String(Number(bitrate) * 2),
  ]
}

function liveAv1Crf(quality: string): string {
  const parsed = Number.parseInt(quality, 10)
  if (!Number.isFinite(parsed)) return "35"
  return String(Math.max(0, Math.min(63, parsed + 12)))
}

function hevcMp4Args(encoder: string): string[] {
  return encoder.includes("hevc") ? HEVC_MP4_TAG_ARGS : NO_ARGS
}
