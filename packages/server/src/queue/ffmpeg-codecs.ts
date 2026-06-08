import type { EncoderCodec, HwaccelKind } from "../config/store"

const CODEC_ENCODERS: Record<
  HwaccelKind,
  Record<EncoderCodec, string | null>
> = {
  none: {
    h264: "libx264",
    hevc: "libx265",
    av1: "libsvtav1",
  },
  amf: {
    h264: "h264_amf",
    hevc: "hevc_amf",
    av1: "av1_amf",
  },
  nvenc: {
    h264: "h264_nvenc",
    hevc: "hevc_nvenc",
    av1: "av1_nvenc",
  },
  qsv: {
    h264: "h264_qsv",
    hevc: "hevc_qsv",
    av1: "av1_qsv",
  },
  rkmpp: {
    h264: "h264_rkmpp",
    hevc: "hevc_rkmpp",
    av1: "av1_rkmpp",
  },
  vaapi: {
    h264: "h264_vaapi",
    hevc: "hevc_vaapi",
    av1: "av1_vaapi",
  },
  videotoolbox: {
    h264: "h264_videotoolbox",
    hevc: "hevc_videotoolbox",
    av1: "av1_videotoolbox",
  },
  v4l2m2m: {
    h264: "h264_v4l2m2m",
    hevc: "hevc_v4l2m2m",
    av1: "av1_v4l2m2m",
  },
}

export function codecNameFor(
  hwaccel: HwaccelKind,
  codec: EncoderCodec,
): string {
  return CODEC_ENCODERS[hwaccel][codec] ?? `${codec}_${hwaccel}`
}
