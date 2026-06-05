import {
  type AdminEncoderCapabilities as EncoderCapabilities,
  ENCODER_HWACCELS,
} from "@workspace/contracts"

import { codecNameFor } from "../queue/ffmpeg-args"

export function emptyEncoderAvailability(): EncoderCapabilities["available"] {
  return {
    none: { h264: false, hevc: false, av1: false },
    amf: { h264: false, hevc: false, av1: false },
    nvenc: { h264: false, hevc: false, av1: false },
    qsv: { h264: false, hevc: false, av1: false },
    rkmpp: { h264: false, hevc: false, av1: false },
    vaapi: { h264: false, hevc: false, av1: false },
    videotoolbox: { h264: false, hevc: false, av1: false },
    v4l2m2m: { h264: false, hevc: false, av1: false },
  }
}

export function encoderAvailabilityFromNames(
  names: ReadonlySet<string>,
): EncoderCapabilities["available"] {
  const available = emptyEncoderAvailability()
  for (const hw of ENCODER_HWACCELS) {
    available[hw] = {
      h264: names.has(codecNameFor(hw, "h264")),
      hevc: names.has(codecNameFor(hw, "hevc")),
      av1: names.has(codecNameFor(hw, "av1")),
    }
  }
  return available
}

export interface EncoderCapabilityProbe {
  encoders: ReadonlySet<string>
  filters: ReadonlySet<string>
  hwaccels: ReadonlySet<string>
}

export function encoderAvailabilityFromProbe(
  probe: EncoderCapabilityProbe,
): EncoderCapabilities["available"] {
  const available = emptyEncoderAvailability()
  for (const hw of ENCODER_HWACCELS) {
    available[hw] = {
      h264: isEncoderAvailable(probe, hw, "h264"),
      hevc: isEncoderAvailable(probe, hw, "hevc"),
      av1: isEncoderAvailable(probe, hw, "av1"),
    }
  }
  return available
}

function isEncoderAvailable(
  probe: EncoderCapabilityProbe,
  hwaccel: (typeof ENCODER_HWACCELS)[number],
  codec: "h264" | "hevc" | "av1",
): boolean {
  const encoder = codecNameFor(hwaccel, codec)
  if (!probe.encoders.has(encoder)) return false

  switch (hwaccel) {
    case "none":
    case "amf":
    case "v4l2m2m":
      return true
    case "nvenc":
      return hasHwaccels(probe, "cuda")
    case "qsv":
      return hasHwaccels(probe, "qsv")
    case "rkmpp":
      return (
        hasHwaccels(probe, "rkmpp") &&
        hasFilters(probe, "scale_rkrga", "vpp_rkrga", "overlay_rkrga")
      )
    case "vaapi":
      return (
        hasHwaccels(probe, "drm", "vaapi") &&
        hasFilters(probe, "hwupload_vaapi")
      )
    case "videotoolbox":
      return hasHwaccels(probe, "videotoolbox")
  }
}

function hasHwaccels(
  probe: EncoderCapabilityProbe,
  ...hwaccels: string[]
): boolean {
  return hwaccels.every((hwaccel) => probe.hwaccels.has(hwaccel))
}

function hasFilters(
  probe: EncoderCapabilityProbe,
  ...filters: string[]
): boolean {
  return filters.every((filter) => probe.filters.has(filter))
}
