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
} from "./renditions"
import { transcodeSettings } from "./transcode-settings"

const FULL_CONFIG = TranscodingConfigSchema.parse({})
const ffmpegAvailable =
  spawnSync(transcodeSettings().ffmpegPath, ["-version"], { stdio: "ignore" })
    .status === 0 &&
  spawnSync(transcodeSettings().ffprobePath, ["-version"], { stdio: "ignore" })
    .status === 0
const x265Available =
  ffmpegAvailable &&
  spawnSync(transcodeSettings().ffmpegPath, ["-hide_banner", "-encoders"], {
    encoding: "utf8",
  }).stdout.includes("libx265")

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
  assert.ok(args.includes("-movflags"))
  assert.ok(args.includes("+faststart"))
  assert.equal(args.at(-1), "media.mp4")
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

test(
  "encodeRendition emits a probeable progressive MP4",
  { skip: !ffmpegAvailable && "ffmpeg/ffprobe not available on PATH" },
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
      assert.equal(encoded.fps, 60)
      assert.ok(encoded.codecs.startsWith("avc1."))
      assert.ok(encoded.codecs.endsWith(",mp4a.40.2"))
      assert.ok(progress.length > 0)
      assert.ok(progress.every((fraction) => fraction >= 0 && fraction <= 1))

      assert.equal(encoded.sizeBytes, (await stat(encoded.filePath)).size)
      // No HLS artifacts: the work dir holds exactly the MP4.
      await assert.rejects(stat(join(workDir, "out-720p", "index.m3u8")))

      // The file itself is a probeable progressive MP4.
      const probed = await probeMedia(encoded.filePath)
      assert.equal(probed.videoCodec, "h264")
      assert.equal(probed.height, 720)
      assert.equal(probed.audioCodec, "aac")
      assert.ok(Math.abs(probed.durationMs - 5000) < 500)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)

test(
  "encodeRendition signals hvc1 in CODECS for hevc renditions",
  { skip: !x265Available && "libx265 not available" },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "alloy-renditions-hevc-"))
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
          "testsrc2=size=640x360:rate=30:duration=2",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          sourcePath,
        ],
      })

      const config = TranscodingConfigSchema.parse({ videoCodec: "hevc" })
      const ladder = effectiveLadder(config, { height: 360, fps: 30 })
      const encoded = await encodeRendition(
        sourcePath,
        join(workDir, "out-360p"),
        config,
        ladder[0]!,
        { durationMs: 2000 },
      )

      // Safari only plays HEVC variants signaled as hvc1; the files are
      // written with hvc1 sample entries and the CODECS string must match.
      assert.ok(
        encoded.codecs.startsWith("hvc1."),
        `expected hvc1 codec string, got "${encoded.codecs}"`,
      )
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)
