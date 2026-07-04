import { runFfprobe, type FfprobeStream } from "./ffprobe"

export interface MediaProbe {
  durationMs: number
  width: number
  height: number
  videoCodec: string
  audioCodec: string | null
  /** Average video frame rate; null when the container doesn't carry one. */
  fps: number | null
  /**
   * RFC 6381 codec parameter strings (e.g. "avc1.64002a", "mp4a.40.2") for
   * canPlayType filtering. Null when the stream doesn't carry enough decoder
   * configuration to derive them.
   */
  videoCodecString: string | null
  audioCodecString: string | null
}

/**
 * Read duration, dimensions, and codecs from a media file via ffprobe. Throws
 * when the file has no parseable video track — the upload pipeline treats
 * that as a rejected source.
 */
export async function probeMedia(
  path: string,
  signal?: AbortSignal,
): Promise<MediaProbe> {
  const probed = await runFfprobe(path, signal)
  const video = probed.streams.find(
    (stream) => stream.codec_type === "video" && stream.codec_name,
  )
  if (!video) throw new Error("No video track found")
  const audio = probed.streams.find(
    (stream) => stream.codec_type === "audio" && stream.codec_name,
  )

  const durationSec = Number.parseFloat(probed.format.duration ?? "")
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Could not determine media duration")
  }
  if (!video.width || !video.height) {
    throw new Error("Missing video dimensions")
  }

  return {
    durationMs: Math.round(durationSec * 1000),
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    fps: parseFrameRate(video.avg_frame_rate),
    videoCodecString: buildVideoCodecString(video),
    audioCodecString: audio ? buildAudioCodecString(audio) : null,
  }
}

function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null
  const [numerator, denominator] = value.split("/", 2).map(Number)
  if (
    numerator === undefined ||
    !Number.isFinite(numerator) ||
    numerator <= 0
  ) {
    return null
  }
  if (denominator === undefined) return numerator
  if (!Number.isFinite(denominator) || denominator <= 0) return null
  return numerator / denominator
}

// profile_idc values for the H.264 profiles our ladder can produce. ffprobe
// reports the human-readable profile name.
const H264_PROFILE_IDC: Record<string, number> = {
  Baseline: 0x42,
  "Constrained Baseline": 0x42,
  Main: 0x4d,
  High: 0x64,
  "High 10": 0x6e,
}

/**
 * Combined RFC 6381 codec list for the clip row's `source_codecs` column;
 * null when the video codec string is unknown so clients fall back to a
 * container-only capability check.
 */
export function sourceCodecsString(
  probe: Pick<MediaProbe, "videoCodecString" | "audioCodecString">,
): string | null {
  if (!probe.videoCodecString) return null
  return [probe.videoCodecString, probe.audioCodecString]
    .filter((value): value is string => !!value)
    .join(",")
}

/**
 * RFC 6381 video codec string from ffprobe stream fields. Exported for unit
 * tests; callers go through {@link probeMedia}.
 */
export function buildVideoCodecString(
  stream: Pick<
    FfprobeStream,
    "codec_name" | "codec_tag_string" | "profile" | "level" | "pix_fmt"
  >,
): string | null {
  if (stream.codec_name === "h264") {
    const profileIdc = H264_PROFILE_IDC[stream.profile ?? ""]
    if (profileIdc === undefined || stream.level === undefined) return null
    return `avc1.${hexByte(profileIdc)}00${hexByte(stream.level)}`
  }
  if (stream.codec_name === "hevc") {
    // Raw uploaded sources can carry hev1 sample entries, and Safari refuses
    // HEVC that is mis-signaled. Renditions still use hvc1 (`-tag:v hvc1`).
    if (stream.level === undefined) return null
    const tag = stream.codec_tag_string === "hev1" ? "hev1" : "hvc1"
    return `${tag}.1.6.L${stream.level}.B0`
  }
  if (stream.codec_name === "av1") {
    if (stream.level === undefined) return null
    const bitDepth = stream.pix_fmt?.includes("10") ? "10" : "08"
    return `av01.0.${String(stream.level).padStart(2, "0")}M.${bitDepth}`
  }
  return null
}

const AUDIO_CODEC_NAME_TO_RFC6381: Record<string, string> = {
  ac3: "ac-3",
  eac3: "ec-3",
}

/**
 * RFC 6381 audio codec string. Sources may carry AAC profiles beyond LC;
 * rendition audio remains ffmpeg AAC-LC. Non-AAC audio falls back to its
 * (mapped) ffprobe codec name so the string still fails `canPlayType` in
 * browsers lacking the codec — dropping it entirely would make an
 * H.264+AC-3 source look fully playable and play silently. Exported for
 * unit tests.
 */
export function buildAudioCodecString(
  stream: Pick<FfprobeStream, "codec_name" | "profile">,
): string | null {
  if (stream.codec_name === "aac") {
    if (stream.profile === "HE-AAC") return "mp4a.40.5"
    if (stream.profile === "HE-AACv2") return "mp4a.40.29"
    return "mp4a.40.2"
  }
  if (!stream.codec_name) return null
  return AUDIO_CODEC_NAME_TO_RFC6381[stream.codec_name] ?? stream.codec_name
}

function hexByte(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0")
}
