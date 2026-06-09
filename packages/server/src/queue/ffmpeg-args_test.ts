import { test } from "node:test"

import type { ResolvedEncoderConfig } from "./ffmpeg-args"
import {
  buildEncodeArgs,
  buildLiveHlsArgs,
  buildLiveTranscodeArgs,
  codecNameFor,
} from "./ffmpeg-args"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertIncludes(args: readonly string[], expected: readonly string[]) {
  const actual = args.join("\u0000")
  const needle = expected.join("\u0000")
  assert(
    actual.includes(needle),
    `expected args to include ${JSON.stringify(expected)}\n${args.join(" ")}`,
  )
}

function assertNotIncludes(
  args: readonly string[],
  unexpected: readonly string[],
) {
  const actual = args.join("\u0000")
  const needle = unexpected.join("\u0000")
  assert(
    !actual.includes(needle),
    `expected args not to include ${JSON.stringify(unexpected)}\n${args.join(
      " ",
    )}`,
  )
}

function assertArgsEqual(args: readonly string[], expected: readonly string[]) {
  assert(
    args.join("\u0000") === expected.join("\u0000"),
    `expected args:\n${expected.join(" ")}\nactual args:\n${args.join(" ")}`,
  )
}

function liveArgs(
  encoder: string,
  overrides: Partial<ResolvedEncoderConfig> = {},
): string[] {
  return buildLiveTranscodeArgs("source.mkv", {
    config: encoderConfig(encoder, overrides),
    targetHeight: 720,
    videoBitrate: 600_000,
    audioBitrate: 24_000,
  })
}

function encodeArgs(
  encoder: string,
  overrides: Partial<ResolvedEncoderConfig> = {},
): string[] {
  return buildEncodeArgs("source.mkv", "out.mp4", {
    config: encoderConfig(encoder, overrides),
    targetHeight: 720,
  })
}

function encoderConfig(
  encoder: string,
  overrides: Partial<ResolvedEncoderConfig> = {},
): ResolvedEncoderConfig {
  return {
    hwaccel: "none",
    encoder,
    quality: 23,
    audioBitrateKbps: 128,
    extraInputArgs: "",
    extraOutputArgs: "",
    qsvDevice: "/dev/dri/renderD128",
    vaapiDevice: "/dev/dri/renderD128",
    intelLowPowerH264: false,
    intelLowPowerHevc: false,
    tonemapping: {
      enabled: true,
      algorithm: "bt2390",
      mode: "auto",
      range: "auto",
      desat: 0,
      peak: 100,
      param: null,
      threshold: 0.2,
      vpp: {
        enabled: true,
        brightness: 16,
        contrast: 1,
      },
    },
    ...overrides,
  }
}

test("codecNameFor maps software codecs to ffmpeg library encoders", () => {
  assert(codecNameFor("none", "h264") === "libx264", "H.264 should use x264")
  assert(codecNameFor("none", "hevc") === "libx265", "HEVC should use x265")
  assert(codecNameFor("none", "av1") === "libsvtav1", "AV1 should use SVT-AV1")
})

test("codecNameFor maps hardware codecs to backend encoder names", () => {
  assert(
    codecNameFor("nvenc", "av1") === "av1_nvenc",
    "NVENC AV1 name should be backend-derived",
  )
  assert(
    codecNameFor("qsv", "hevc") === "hevc_qsv",
    "QSV HEVC name should be backend-derived",
  )
  assert(
    codecNameFor("rkmpp", "h264") === "h264_rkmpp",
    "RKMPP H.264 name should match Jellyfin's suffix map",
  )
  assert(
    codecNameFor("v4l2m2m", "hevc") === "hevc_v4l2m2m",
    "V4L2 HEVC name should match Jellyfin's suffix map",
  )
})

test("buildLiveTranscodeArgs uses capped CRF for SVT-AV1 live output", () => {
  const args = liveArgs("libsvtav1")

  assertIncludes(args, ["-c:v", "libsvtav1", "-preset", "10"])
  assertIncludes(args, ["-crf", "35", "-maxrate", "600000"])
  assertIncludes(args, ["-bufsize", "1200000", "-pix_fmt", "yuv420p"])
  assertNotIncludes(args, ["-svtav1-params"])
})

test("buildLiveHlsArgs emits fMP4 HLS output with stable segment names", () => {
  const args = buildLiveHlsArgs("source.mkv", "/cache/key/stream.m3u8", {
    config: encoderConfig("libx264"),
    targetHeight: 720,
    videoBitrate: 600_000,
    audioBitrate: 128_000,
    segmentLengthSec: 3,
    startNumber: 4,
    startTimeSec: 12,
    segmentPattern: "/cache/key/key%d.mp4",
    initFilename: "key-init.mp4",
  })

  assertIncludes(args, ["-ss", "12", "-i", "source.mkv"])
  assertIncludes(args, ["-copyts", "-avoid_negative_ts", "disabled"])
  // Keyframe schedule is offset by startNumber so cut points stay on absolute
  // segment boundaries when -copyts keeps timestamps non-zero-based.
  assertIncludes(args, ["-force_key_frames", "expr:gte(t,(n_forced+4)*3)"])
  assertIncludes(args, ["-f", "hls", "-max_delay", "5000000"])
  assertIncludes(args, ["-hls_time", "3", "-hls_segment_type", "fmp4"])
  assertIncludes(args, ["-hls_fmp4_init_filename", "key-init.mp4"])
  assertIncludes(args, ["-start_number", "4"])
  assertIncludes(args, ["-hls_segment_filename", "/cache/key/key%d.mp4"])
  assertIncludes(args, ["-hls_playlist_type", "vod", "-hls_list_size", "0"])
  assertIncludes(args, ["-hls_segment_options", "movflags=+frag_discont"])
  assert(args.at(-1) === "/cache/key/stream.m3u8", "playlist should be last")
})

test("buildEncodeArgs rounds odd software target heights down", () => {
  const args = buildEncodeArgs("source.mkv", "out.mp4", {
    config: encoderConfig("libx264"),
    targetHeight: 1079,
  })

  assertIncludes(args, [
    "-vf",
    "scale=-2:1078:force_original_aspect_ratio=decrease,format=yuv420p",
  ])
})

test("buildEncodeArgs maps primary video and optional audio only", () => {
  const args = encodeArgs("libx264")

  assertIncludes(args, ["-i", "source.mkv", "-map", "0:v:0", "-map", "0:a?"])
  assertIncludes(args, ["-sn", "-dn", "-vf"])
})

test("buildLiveTranscodeArgs applies Jellyfin-style QSV rate control", () => {
  const args = liveArgs("h264_qsv", { hwaccel: "qsv" })

  assertIncludes(args, ["-qsv_device", "/dev/dri/renderD128"])
  assertIncludes(args, ["-c:v", "h264_qsv", "-preset", "veryfast"])
  assertIncludes(args, ["-mbbrc", "1", "-b:v", "1000000"])
  assertIncludes(args, ["-maxrate", "1000001", "-rc_init_occupancy", "1000000"])
})

test("buildLiveTranscodeArgs generates stable QSV low-power H.264 command", () => {
  const args = liveArgs("h264_qsv", {
    hwaccel: "qsv",
    intelLowPowerH264: true,
  })

  assertArgsEqual(args, [
    "-hide_banner",
    "-nostdin",
    "-qsv_device",
    "/dev/dri/renderD128",
    "-i",
    "source.mkv",
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-sn",
    "-dn",
    "-vf",
    "scale=-2:720:force_original_aspect_ratio=decrease,format=yuv420p",
    "-c:v",
    "h264_qsv",
    "-low_power",
    "1",
    "-preset",
    "veryfast",
    "-mbbrc",
    "1",
    "-b:v",
    "1000000",
    "-maxrate",
    "1000001",
    "-rc_init_occupancy",
    "1000000",
    "-bufsize",
    "2000000",
    "-c:a",
    "aac",
    "-b:a",
    "32000",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-movflags",
    "+frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  ])
})

test("buildLiveTranscodeArgs applies NVENC live defaults and HEVC tag", () => {
  const args = liveArgs("hevc_nvenc", { hwaccel: "nvenc" })

  assertIncludes(args, ["-c:v", "hevc_nvenc", "-preset", "p1"])
  assertIncludes(args, ["-rc", "vbr", "-b:v", "600000"])
  assertIncludes(args, ["-tag:v", "hvc1"])
})

test("buildLiveTranscodeArgs tags libx265 output as hvc1", () => {
  // libx265's name lacks "hevc", so the tag was previously skipped, producing
  // hev1 sample entries instead of the broadly-compatible hvc1.
  const args = liveArgs("libx265")

  assertIncludes(args, ["-c:v", "libx265", "-preset", "veryfast"])
  assertIncludes(args, ["-tag:v", "hvc1"])
})

test("buildLiveTranscodeArgs uploads VAAPI frames and uses VBR mode", () => {
  const args = buildLiveTranscodeArgs("source.mkv", {
    config: encoderConfig("hevc_vaapi", { hwaccel: "vaapi" }),
    targetHeight: 1079,
    videoBitrate: 600_000,
    audioBitrate: 24_000,
  })

  assertIncludes(args, ["-vaapi_device", "/dev/dri/renderD128"])
  assertIncludes(args, [
    "-vf",
    "scale=-2:1078:force_original_aspect_ratio=decrease,format=nv12,hwupload_vaapi",
  ])
  assertIncludes(args, ["-rc_mode", "VBR", "-b:v", "600000"])
  assertIncludes(args, ["-tag:v", "hvc1"])
})

test("buildLiveTranscodeArgs applies Jellyfin-style HDR tone mapping", () => {
  const args = liveArgs("libx264", {
    sourceColor: {
      primaries: "bt2020",
      transfer: "smpte2084",
      space: "bt2020nc",
      range: "tv",
      isHdr: true,
    },
    tonemapping: {
      enabled: true,
      algorithm: "mobius",
      mode: "auto",
      range: "limited",
      desat: 0.5,
      peak: 100,
      param: 0.3,
      threshold: 0.2,
      vpp: {
        enabled: true,
        brightness: 16,
        contrast: 1,
      },
    },
  })

  assertIncludes(args, ["-init_hw_device", "opencl=ocl"])
  assertIncludes(args, ["-filter_hw_device", "ocl"])
  assertIncludes(args, [
    "-vf",
    "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc,format=p010le,hwupload,tonemap_opencl=format=yuv420p:p=bt709:t=bt709:m=bt709:tonemap=mobius:tonemap_mode=auto:peak=100:desat=0.5:threshold=0.2:param=0.3:r=limited,hwdownload,format=yuv420p,scale=-2:720:force_original_aspect_ratio=decrease,format=yuv420p",
  ])
})

test("buildLiveTranscodeArgs prefers QSV VPP tone mapping when enabled", () => {
  const args = liveArgs("h264_qsv", {
    hwaccel: "qsv",
    sourceColor: {
      primaries: "bt2020",
      transfer: "smpte2084",
      space: "bt2020nc",
      range: "tv",
      isHdr: true,
    },
  })

  assertIncludes(args, ["-qsv_device", "/dev/dri/renderD128"])
  assertIncludes(args, [
    "-vf",
    "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc,format=nv12,hwupload=extra_hw_frames=16,format=qsv,vpp_qsv=w=-1:h=720:format=nv12:tonemap=1:procamp=1:brightness=16:contrast=1:out_color_matrix=bt709:out_color_primaries=bt709:out_color_transfer=bt709",
  ])
  assertNotIncludes(args, ["-init_hw_device", "opencl=ocl"])
  assert(!args.join(" ").includes("tonemap_opencl"), "QSV VPP should win")
})

test("buildLiveTranscodeArgs skips tone mapping for SDR sources", () => {
  const args = liveArgs("libx264", {
    sourceColor: {
      primaries: "bt709",
      transfer: "bt709",
      space: "bt709",
      range: "tv",
      isHdr: false,
    },
  })

  assertIncludes(args, [
    "-vf",
    "scale=-2:720:force_original_aspect_ratio=decrease,format=yuv420p",
  ])
  assert(!args.join(" ").includes("tonemap_opencl"), "SDR should not tone map")
})

test("buildLiveTranscodeArgs applies AMF live CBR defaults", () => {
  const args = liveArgs("hevc_amf", { hwaccel: "amf" })

  assertIncludes(args, ["-quality", "speed", "-header_insertion_mode", "gop"])
  assertIncludes(args, ["-gops_per_idr", "1", "-rc", "cbr"])
  assertIncludes(args, ["-qmin", "0", "-qmax", "32", "-b:v", "600000"])
  assertIncludes(args, ["-tag:v", "hvc1"])
})

test("buildLiveTranscodeArgs applies AV1 AMF header insertion without H.26x CBR overrides", () => {
  const args = liveArgs("av1_amf", { hwaccel: "amf" })

  assertIncludes(args, ["-c:v", "av1_amf", "-quality", "speed"])
  assertIncludes(args, ["-header_insertion_mode", "gop"])
  assertIncludes(args, ["-b:v", "600000", "-maxrate", "600000"])
  assertNotIncludes(args, ["-qmin", "0", "-qmax", "32"])
  assertNotIncludes(args, ["-gops_per_idr"])
})

test("buildLiveTranscodeArgs applies AV1 QSV VBR without H.26x MBBRC", () => {
  const args = liveArgs("av1_qsv", { hwaccel: "qsv" })

  assertIncludes(args, ["-c:v", "av1_qsv", "-preset", "veryfast"])
  assertIncludes(args, ["-b:v", "600000", "-maxrate", "600001"])
  assertIncludes(args, ["-rc_init_occupancy", "600000", "-bufsize", "1200000"])
  assertNotIncludes(args, ["-mbbrc", "1"])
})

test("buildLiveTranscodeArgs applies AV1 NVENC defaults without profile or level", () => {
  const args = liveArgs("av1_nvenc", { hwaccel: "nvenc" })

  assertIncludes(args, ["-c:v", "av1_nvenc", "-preset", "p1"])
  assertIncludes(args, ["-rc", "vbr", "-b:v", "600000"])
  assertNotIncludes(args, ["-profile:v"])
  assertNotIncludes(args, ["-level"])
})

test("buildLiveTranscodeArgs applies explicit RKMPP live defaults", () => {
  const args = liveArgs("hevc_rkmpp", { hwaccel: "rkmpp" })

  assertIncludes(args, ["-c:v", "hevc_rkmpp"])
  assertIncludes(args, ["-b:v", "600000", "-maxrate", "600000"])
  assertIncludes(args, ["-bufsize", "1200000"])
  assertIncludes(args, ["-tag:v", "hvc1"])
  assertNotIncludes(args, ["-preset"])
})

test("buildLiveTranscodeArgs applies explicit V4L2 live defaults", () => {
  const args = liveArgs("h264_v4l2m2m", { hwaccel: "v4l2m2m" })

  assertIncludes(args, ["-c:v", "h264_v4l2m2m"])
  assertIncludes(args, ["-b:v", "600000", "-maxrate", "600000"])
  assertIncludes(args, ["-bufsize", "1200000"])
  assertNotIncludes(args, ["-preset"])
})

test("buildLiveTranscodeArgs applies Intel low-power only to QSV H.264 and HEVC", () => {
  const h264Args = liveArgs("h264_qsv", {
    hwaccel: "qsv",
    intelLowPowerH264: true,
    intelLowPowerHevc: true,
  })
  const hevcArgs = liveArgs("hevc_qsv", {
    hwaccel: "qsv",
    intelLowPowerH264: true,
    intelLowPowerHevc: true,
  })
  const av1Args = liveArgs("av1_qsv", {
    hwaccel: "qsv",
    intelLowPowerH264: true,
    intelLowPowerHevc: true,
  })

  assertIncludes(h264Args, ["-c:v", "h264_qsv", "-low_power", "1"])
  assertIncludes(hevcArgs, ["-c:v", "hevc_qsv", "-low_power", "1"])
  assertNotIncludes(av1Args, ["-low_power", "1"])
})

test("buildEncodeArgs applies Intel low-power only to QSV H.264 and HEVC", () => {
  const h264Args = encodeArgs("h264_qsv", {
    hwaccel: "qsv",
    intelLowPowerH264: true,
    intelLowPowerHevc: true,
  })
  const hevcArgs = encodeArgs("hevc_qsv", {
    hwaccel: "qsv",
    intelLowPowerH264: true,
    intelLowPowerHevc: true,
  })
  const av1Args = encodeArgs("av1_qsv", {
    hwaccel: "qsv",
    intelLowPowerH264: true,
    intelLowPowerHevc: true,
  })

  assertIncludes(h264Args, ["-c:v", "h264_qsv", "-low_power", "1"])
  assertIncludes(hevcArgs, ["-c:v", "hevc_qsv", "-low_power", "1"])
  assertNotIncludes(av1Args, ["-low_power", "1"])
})
