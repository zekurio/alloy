import type { ResolvedEncoderConfig, SourceColorInfo } from "./ffmpeg-args"

export function buildHardwareArgs(config: ResolvedEncoderConfig): string[] {
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

export function buildFilterChain(
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
