import {
  canPlaySourceFromSupport,
  sourceMimeCandidates,
} from "./source-playback"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test("sourceMimeCandidates probes container only without codec hints", () => {
  const candidates = sourceMimeCandidates("video/x-matroska")

  assert(
    candidates.join("|") === "video/x-matroska|video/mkv|video/matroska",
    "Matroska container aliases should be probed",
  )
})

Deno.test("sourceMimeCandidates probes container and codec combo first", () => {
  const candidates = sourceMimeCandidates("video/x-matroska", {
    videoCodec: "hevc",
    audioCodec: "aac",
  })

  assert(
    candidates[0] === 'video/x-matroska; codecs="hvc1.1.L120,mp4a.40.2"',
    "codec-specific Matroska probe should be first",
  )
  assert(
    candidates.includes(
      'video/x-matroska; codecs="hev1.1.L120,mp4a.40.2"',
    ),
    "HEVC hev1 alias should be probed",
  )
  assert(
    candidates.includes('video/mkv; codecs="hvc1.1.L120,mp4a.40.2"'),
    "video/mkv Matroska alias should be probed",
  )
  assert(
    candidates[candidates.length - 1] === "video/matroska",
    "plain container probe should remain as fallback",
  )
})

Deno.test("sourceMimeCandidates normalizes common ffprobe codec names", () => {
  const candidates = sourceMimeCandidates("video/mp4", {
    videoCodec: "h265",
    audioCodec: "mpeg4aac",
  })

  assert(
    candidates[0] === 'video/mp4; codecs="hvc1.1.L120,mp4a.40.2"',
    "ffprobe aliases should map to browser codec strings",
  )
})

Deno.test("canPlaySourceFromSupport accepts codec-specific browser support", () => {
  const playable = canPlaySourceFromSupport("video/x-matroska", {
    canPlayType: (mimeType) => mimeType.includes("hev1") ? "probably" : "",
  }, {
    videoCodec: "hevc",
    audioCodec: "aac",
  })

  assert(playable, "codec-specific Matroska support should be detected")
})

Deno.test("sourceMimeCandidates includes Jellyfin-style VP9 and MP3 aliases", () => {
  const candidates = sourceMimeCandidates("video/webm", {
    videoCodec: "vp9",
    audioCodec: "mp3",
  })

  assert(
    candidates.includes('video/webm; codecs="vp9,mp3"'),
    "VP9 short codec string should be probed",
  )
  assert(
    candidates.includes('video/webm; codecs="vp09.00.10.08,mp4a.69"'),
    "VP9 and MP3 browser aliases should be probed",
  )
})

Deno.test("sourceMimeCandidates includes MP4 and M4V container aliases", () => {
  const candidates = sourceMimeCandidates("video/mp4", {
    videoCodec: "h264",
    audioCodec: "aac",
  })

  assert(
    candidates.includes('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),
    "MP4 should be probed with codecs",
  )
  assert(
    candidates.includes('video/x-m4v; codecs="avc1.42E01E,mp4a.40.2"'),
    "M4V alias should be probed with codecs",
  )
  assert(
    candidates.at(-1) === "video/x-m4v",
    "plain M4V alias should be the final fallback",
  )
})
