import {
  ALL_FORMATS,
  FilePathSource,
  Input,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny"

export interface MediaProbe {
  durationMs: number
  width: number
  height: number
  videoCodec: string
  audioCodec: string | null
}

// Keep the codec vocabulary the rest of the app (and the web player's MIME
// mapping) already speaks; mediabunny says "avc" where we store "h264".
const VIDEO_CODEC_NAMES: Partial<Record<VideoCodec, string>> = {
  avc: "h264",
  hevc: "hevc",
  av1: "av1",
  vp9: "vp9",
  vp8: "vp8",
}

/**
 * Read duration, dimensions, and codecs from a media file. Throws when the
 * file has no parseable video track — the upload pipeline treats that as a
 * rejected source.
 */
export async function probeMedia(path: string): Promise<MediaProbe> {
  const input = new Input({
    source: new FilePathSource(path),
    formats: ALL_FORMATS,
  })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error("No video track found")
    const audio = await input.getPrimaryAudioTrack()

    const durationSec = await input.computeDuration()
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error("Could not determine media duration")
    }
    const width = await video.getDisplayWidth()
    const height = await video.getDisplayHeight()
    if (!width || !height) throw new Error("Missing video dimensions")

    const videoCodec = await video.getCodec()
    const audioCodec = (await audio?.getCodec()) ?? null
    return {
      durationMs: Math.round(durationSec * 1000),
      width,
      height,
      videoCodec: videoCodecName(videoCodec),
      audioCodec: audioCodec ? audioCodecName(audioCodec) : null,
    }
  } finally {
    input.dispose()
  }
}

function videoCodecName(codec: VideoCodec | null): string {
  if (!codec) return "unknown"
  return VIDEO_CODEC_NAMES[codec] ?? codec
}

function audioCodecName(codec: AudioCodec): string {
  return codec
}
