import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { TranscodingConfigSchema } from "@alloy/contracts"

import {
  parseFfmpegEncoders,
  probeTranscodingCapabilities,
} from "./capabilities"
import { runFfmpeg } from "./ffmpeg"
import { probeMedia } from "./probe"
import {
  buildRenditionArgs,
  effectiveLadder,
  encodeRendition,
  mediaPlaylistStats,
  RENDITION_MEDIA_URI_PLACEHOLDER,
  renderMasterPlaylist,
  renderMediaPlaylist,
  SEGMENT_SECONDS,
} from "./renditions"
import { transcodeSettings } from "./transcode-settings"

const FULL_CONFIG = TranscodingConfigSchema.parse({})
const ffmpegAvailable =
  spawnSync(transcodeSettings().ffmpegPath, ["-version"], { stdio: "ignore" })
    .status === 0

test("effectiveLadder produces the full ladder below a 1440p60 source", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 1440, fps: 60 })
  assert.deepEqual(
    ladder.map((step) => step.height),
    [1080, 720, 480],
  )
  // 60fps source: top tiers keep the source rate uncapped, 480p caps to 30.
  assert.equal(ladder[0]?.capFps, false)
  assert.equal(ladder[0]?.fps, 60)
  assert.equal(ladder[2]?.capFps, true)
  assert.equal(ladder[2]?.fps, 30)
  // Minimal names: no fps or codec suffix needed, og only on the default tier.
  assert.deepEqual(
    ladder.map((step) => step.name),
    ["1080p", "720p", "480p"],
  )
  assert.deepEqual(
    ladder.map((step) => step.og),
    [true, false, false],
  )
})

test("effectiveLadder appends fps only when same-height tiers differ in fps", () => {
  const ladder = effectiveLadder(
    TranscodingConfigSchema.parse({
      tiers: [
        { height: 1080, maxFps: 60, maxrateKbps: 8000 },
        { height: 1080, maxFps: 30, maxrateKbps: 5000 },
      ],
    }),
    { height: 1080, fps: 120 },
  )
  assert.deepEqual(
    ladder.map((step) => step.name),
    ["1080p60", "1080p30"],
  )
})

test("effectiveLadder appends the codec only when fps cannot disambiguate", () => {
  const ladder = effectiveLadder(
    TranscodingConfigSchema.parse({
      videoCodec: "h264",
      tiers: [
        { height: 1080, maxFps: 60, maxrateKbps: 8000 },
        { height: 1080, maxFps: 60, maxrateKbps: 8000, codec: "hevc" },
      ],
    }),
    { height: 1080, fps: 60 },
  )
  // Same height and fps: stable config order, disambiguated by codec.
  assert.deepEqual(
    ladder.map((step) => step.name),
    ["1080p-h264", "1080p-hevc"],
  )
})

test("effectiveLadder collapse keeps the highest maxrate and the og flag", () => {
  const ladder = effectiveLadder(
    TranscodingConfigSchema.parse({
      tiers: [
        { height: 1440, maxFps: 60, maxrateKbps: 12000, og: true },
        { height: 1080, maxFps: 60, maxrateKbps: 8000 },
      ],
    }),
    { height: 1080, fps: 60 },
  )
  assert.equal(ladder.length, 1)
  assert.equal(ladder[0]?.name, "1080p")
  assert.equal(ladder[0]?.og, true)
  assert.equal(ladder[0]?.tier.maxrateKbps, 12000)
})

test("effectiveLadder clamps to the source height without upscaling", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 900, fps: 30 })
  assert.deepEqual(
    ladder.map((step) => step.height),
    [900, 720, 480],
  )
})

test("effectiveLadder dedupes tiers that collapse to the same height", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 720, fps: 60 })
  assert.deepEqual(
    ladder.map((step) => step.height),
    [720, 480],
  )
  // When clamping collapses tiers, the highest maxrate target wins.
  assert.equal(ladder[0]?.tier.maxrateKbps, 8000)
})

test("effectiveLadder rounds odd source heights down to even", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 719, fps: 30 })
  assert.equal(ladder[0]?.height, 718)
})

test("effectiveLadder yields one compat tier for tiny sources", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 360, fps: 30 })
  assert.deepEqual(
    ladder.map((step) => step.height),
    [360],
  )
  assert.equal(ladder[0]?.tier.maxrateKbps, 8000)
})

test("effectiveLadder respects disabled tiers", () => {
  const ladder = effectiveLadder(
    TranscodingConfigSchema.parse({
      tiers: [{ height: 720, maxFps: 60, maxrateKbps: 5000 }],
    }),
    { height: 1440, fps: 60 },
  )
  assert.deepEqual(
    ladder.map((step) => step.height),
    [720],
  )
})

test("effectiveLadder caps fps when the source rate is unknown", () => {
  const ladder = effectiveLadder(FULL_CONFIG, { height: 1080, fps: null })
  assert.ok(ladder.every((step) => step.capFps))
  assert.equal(ladder[0]?.fps, 60)
})

test("effectiveLadder uses custom tier order and fps caps", () => {
  const ladder = effectiveLadder(
    TranscodingConfigSchema.parse({
      tiers: [
        { height: 480, maxFps: 30, maxrateKbps: 2500 },
        { height: 1440, maxFps: 120, maxrateKbps: 12000 },
      ],
    }),
    { height: 2160, fps: 144 },
  )
  assert.deepEqual(
    ladder.map((step) => step.height),
    [1440, 480],
  )
  assert.equal(ladder[0]?.fps, 120)
  assert.equal(ladder[0]?.capFps, true)
})

test("effectiveLadder resolves per-tier codec overrides", () => {
  const config = TranscodingConfigSchema.parse({
    videoCodec: "h264",
    tiers: [
      { height: 1080, maxFps: 60, maxrateKbps: 8000, codec: "av1" },
      { height: 720, maxFps: 60, maxrateKbps: 5000 },
    ],
  })
  const ladder = effectiveLadder(config, { height: 1440, fps: 60 })
  assert.deepEqual(
    ladder.map((step) => [step.height, step.codec]),
    [
      [1080, "av1"],
      [720, "h264"],
    ],
  )
})

test("buildRenditionArgs uses the tier codec override", () => {
  const config = TranscodingConfigSchema.parse({
    videoCodec: "h264",
    tiers: [
      { height: 1080, maxFps: 60, maxrateKbps: 8000, codec: "hevc" },
      { height: 720, maxFps: 60, maxrateKbps: 5000 },
    ],
  })
  const ladder = effectiveLadder(config, { height: 1080, fps: 60 })
  const topArgs = buildRenditionArgs({
    config,
    srcPath: "source.mp4",
    step: ladder[0]!,
  })
  assert.ok(topArgs.includes("libx265"))
  assert.ok(topArgs.includes("hvc1"))
  const lowArgs = buildRenditionArgs({
    config,
    srcPath: "source.mp4",
    step: ladder[1]!,
  })
  assert.ok(lowArgs.includes("libx264"))
})

test("TranscodingConfigSchema migrates legacy toggles to tiers", () => {
  const config = TranscodingConfigSchema.parse({
    enable1080p: false,
    enable720p: true,
    enable480p: false,
  })
  assert.deepEqual(config.tiers, [
    { height: 720, maxFps: 60, maxrateKbps: 5000 },
  ])
})

test("buildRenditionArgs keeps libx264 shape", () => {
  const args = buildRenditionArgs({
    config: FULL_CONFIG,
    srcPath: "source.mp4",
    step: effectiveLadder(FULL_CONFIG, { height: 1080, fps: 60 })[0]!,
  })
  assert.deepEqual(args.slice(0, 5), ["-v", "error", "-y", "-i", "source.mp4"])
  assert.ok(args.includes("libx264"))
  assert.ok(args.includes("-sc_threshold"))
  assert.ok(args.includes("-crf"))
  assert.ok(args.includes("22"))
  assert.ok(args.includes("-pix_fmt"))
  assert.ok(args.includes("yuv420p"))
  assert.ok(args.includes("-maxrate"))
  assert.ok(args.includes("8000k"))
  assert.ok(args.includes("-b:a"))
  assert.ok(args.includes("128k"))
})

test("buildRenditionArgs tags hevc and omits x264-only scenecut arg", () => {
  const config = TranscodingConfigSchema.parse({ videoCodec: "hevc" })
  const args = buildRenditionArgs({
    config,
    srcPath: "source.mp4",
    step: effectiveLadder(config, { height: 1080, fps: 60 })[0]!,
  })
  assert.ok(args.includes("libx265"))
  assert.ok(!args.includes("-sc_threshold"))
  assert.ok(args.includes("-x265-params"))
  assert.ok(args.includes("scenecut=0"))
  assert.ok(args.includes("-tag:v"))
  assert.ok(args.includes("hvc1"))
})

test("buildRenditionArgs uses nvenc cq controls", () => {
  const config = TranscodingConfigSchema.parse({
    hardwareAcceleration: "nvenc",
    quality: 24,
  })
  const args = buildRenditionArgs({
    config,
    srcPath: "source.mp4",
    step: effectiveLadder(config, { height: 1080, fps: 60 })[0]!,
  })
  assert.ok(args.includes("h264_nvenc"))
  assert.ok(args.includes("-cq"))
  assert.ok(args.includes("24"))
  assert.ok(args.includes("-rc"))
  assert.ok(args.includes("vbr"))
})

test("buildRenditionArgs uploads vaapi frames and sets device", () => {
  const config = TranscodingConfigSchema.parse({
    hardwareAcceleration: "vaapi",
    vaapiDevice: "/dev/dri/test",
  })
  const args = buildRenditionArgs({
    config,
    srcPath: "source.mp4",
    step: effectiveLadder(config, { height: 1080, fps: 60 })[0]!,
  })
  assert.deepEqual(args.slice(0, 7), [
    "-v",
    "error",
    "-y",
    "-vaapi_device",
    "/dev/dri/test",
    "-i",
    "source.mp4",
  ])
  assert.ok(args.includes("h264_vaapi"))
  assert.ok(args.includes("scale=-2:1080:flags=lanczos,format=nv12,hwupload"))
})

test("parseFfmpegEncoders reads present encoders from ffmpeg output", () => {
  const encoders = parseFfmpegEncoders(`Encoders:
 V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V..... hevc_nvenc           NVIDIA NVENC hevc encoder
 A..... aac                  AAC (Advanced Audio Coding)
`)
  assert.equal(encoders.has("libx264"), true)
  assert.equal(encoders.has("hevc_nvenc"), true)
  assert.equal(encoders.has("av1_videotoolbox"), false)
})

test(
  "probeTranscodingCapabilities functionally verifies libx264 when ffmpeg is available",
  { skip: !ffmpegAvailable && "ffmpeg not available on PATH" },
  async () => {
    const capabilities = await probeTranscodingCapabilities({ refresh: true })
    const libx264 = capabilities.encoders.find(
      (encoder) => encoder.codec === "h264" && encoder.acceleration === "none",
    )
    assert.equal(libx264?.encoder, "libx264")
    assert.equal(libx264?.status, "ok")
  },
)

const SAMPLE_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="${RENDITION_MEDIA_URI_PLACEHOLDER}",BYTERANGE="1373@0"
#EXTINF:2.000000,
#EXT-X-BYTERANGE:420669@1373
${RENDITION_MEDIA_URI_PLACEHOLDER}
#EXTINF:2.000000,
#EXT-X-BYTERANGE:502091@422042
${RENDITION_MEDIA_URI_PLACEHOLDER}
#EXTINF:1.000000,
#EXT-X-BYTERANGE:255267@924133
${RENDITION_MEDIA_URI_PLACEHOLDER}
#EXT-X-ENDLIST
`

test("mediaPlaylistStats derives the peak segment bitrate", () => {
  const stats = mediaPlaylistStats(SAMPLE_PLAYLIST)
  assert.ok(stats)
  assert.equal(stats.segmentCount, 3)
  // The short tail segment carries the highest rate: 255267 bytes over 1s.
  assert.equal(stats.peakBitrate, 255267 * 8)
})

test("mediaPlaylistStats returns null without segments", () => {
  assert.equal(mediaPlaylistStats("#EXTM3U\n#EXT-X-ENDLIST\n"), null)
})

test("renderMediaPlaylist substitutes every URI occurrence", () => {
  const rendered = renderMediaPlaylist(SAMPLE_PLAYLIST, "file.mp4?v=abc")
  assert.ok(!rendered.includes(RENDITION_MEDIA_URI_PLACEHOLDER))
  assert.equal(rendered.match(/file\.mp4\?v=abc/g)?.length, 4)
  assert.ok(
    rendered.includes('#EXT-X-MAP:URI="file.mp4?v=abc",BYTERANGE="1373@0"'),
  )
})

test("renderMasterPlaylist orders tiers and omits empty CODECS", () => {
  const master = renderMasterPlaylist([
    {
      height: 480,
      width: 854,
      fps: 30,
      codecs: "",
      bandwidth: 1_500_000,
      playlistUrl: "rendition/480/index.m3u8?v=b",
    },
    {
      height: 1080,
      width: 1920,
      fps: 60,
      codecs: "avc1.64002a,mp4a.40.2",
      bandwidth: 8_000_000,
      playlistUrl: "rendition/1080/index.m3u8?v=a",
    },
  ])
  const lines = master.trim().split("\n")
  assert.equal(lines[0], "#EXTM3U")
  const streamInfIndex = lines.findIndex((line) =>
    line.startsWith("#EXT-X-STREAM-INF:"),
  )
  assert.ok(
    lines[streamInfIndex]?.includes(
      'BANDWIDTH=8000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002a,mp4a.40.2"',
    ),
  )
  assert.equal(lines[streamInfIndex + 1], "rendition/1080/index.m3u8?v=a")
  const lowTier = lines.find((line) => line.includes("RESOLUTION=854x480"))
  assert.ok(lowTier)
  assert.ok(!lowTier.includes("CODECS"))
})

test("renderMasterPlaylist breaks same-height ties by bandwidth", () => {
  const master = renderMasterPlaylist([
    {
      height: 1080,
      width: 1920,
      fps: 30,
      codecs: "",
      bandwidth: 4_000_000,
      playlistUrl: "rendition/1080p30/index.m3u8?v=b",
    },
    {
      height: 1080,
      width: 1920,
      fps: 60,
      codecs: "",
      bandwidth: 8_000_000,
      playlistUrl: "rendition/1080p60/index.m3u8?v=a",
    },
  ])
  const urls = master
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("rendition/"))
  assert.deepEqual(urls, [
    "rendition/1080p60/index.m3u8?v=a",
    "rendition/1080p30/index.m3u8?v=b",
  ])
})

test(
  "encodeRendition emits an aligned single-file fMP4 with byte-range playlist",
  { skip: !ffmpegAvailable && "ffmpeg not available on PATH" },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "alloy-renditions-test-"))
    try {
      const sourcePath = join(workDir, "source.mp4")
      await runFfmpeg({
        timeoutMs: 120_000,
        args: [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=1280x720:rate=60:duration=5",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=5",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-shortest",
          sourcePath,
        ],
      })

      const ladder = effectiveLadder(FULL_CONFIG, { height: 720, fps: 60 })
      assert.deepEqual(
        ladder.map((step) => step.height),
        [720, 480],
      )

      const progress: number[] = []
      const encoded = await encodeRendition(
        sourcePath,
        join(workDir, "out-720p"),
        FULL_CONFIG,
        ladder[0]!,
        { durationMs: 5000, onProgress: (fraction) => progress.push(fraction) },
      )

      assert.equal(encoded.height, 720)
      assert.equal(encoded.width, 1280)
      assert.ok(encoded.codecs.startsWith("avc1."))
      assert.ok(encoded.bandwidth > 0)
      assert.ok(progress.length > 0)
      assert.ok(progress.every((fraction) => fraction >= 0 && fraction <= 1))

      // The stored playlist must reference only the placeholder.
      assert.ok(encoded.playlist.includes(RENDITION_MEDIA_URI_PLACEHOLDER))
      assert.ok(!encoded.playlist.includes("media.mp4"))

      // Byte ranges must tile the file exactly: init segment from offset 0,
      // then contiguous segments ending at the file size.
      const fileSize = (await stat(encoded.filePath)).size
      assert.equal(encoded.sizeBytes, fileSize)
      const mapMatch = encoded.playlist.match(/BYTERANGE="(\d+)@(\d+)"/)
      assert.ok(mapMatch)
      assert.equal(Number(mapMatch[2]), 0)
      let expectedOffset = Number(mapMatch[1])
      for (const match of encoded.playlist.matchAll(
        /#EXT-X-BYTERANGE:(\d+)@(\d+)/g,
      )) {
        assert.equal(Number(match[2]), expectedOffset)
        expectedOffset += Number(match[1])
      }
      assert.equal(expectedOffset, fileSize)

      // Segment durations must sum to the media duration on the 2s grid.
      const durations = [
        ...encoded.playlist.matchAll(/#EXTINF:([\d.]+),/g),
      ].map((match) => Number(match[1]))
      assert.ok(durations.length >= 2)
      const total = durations.reduce((sum, value) => sum + value, 0)
      assert.ok(Math.abs(total - 5) < 0.5)
      assert.ok(
        durations
          .slice(0, -1)
          .every((value) => Math.abs(value - SEGMENT_SECONDS) < 0.05),
      )

      // The single file itself is a probeable progressive MP4.
      const probed = await probeMedia(encoded.filePath)
      assert.equal(probed.videoCodec, "h264")
      assert.equal(probed.height, 720)
      assert.equal(probed.audioCodec, "aac")
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)
