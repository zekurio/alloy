import assert from "node:assert/strict"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { TranscodingConfigSchema } from "@alloy/contracts"

import { probeTranscodingCapabilities } from "./capabilities"
import { runFfmpeg } from "./ffmpeg"
import { probeMedia } from "./probe"
import { effectiveLadder, encodeRendition } from "./renditions"

const FULL_CONFIG = TranscodingConfigSchema.parse({})
test("probeTranscodingCapabilities functionally verifies libx264 when ffmpeg is available", async () => {
  const capabilities = await probeTranscodingCapabilities({ refresh: true })
  const libx264 = capabilities.encoders.find(
    (encoder) => encoder.codec === "h264" && encoder.acceleration === "none",
  )
  assert.equal(libx264?.encoder, "libx264")
  assert.equal(libx264?.status, "ok")
})

test("encodeRendition emits a probeable progressive MP4", async () => {
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

    const ladder = effectiveLadder(FULL_CONFIG, {
      height: 720,
      fps: 60,
      browserSafe: false,
    })
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
})

test("encodeRendition signals hvc1 in CODECS for hevc renditions", async () => {
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
    const ladder = effectiveLadder(config, {
      height: 360,
      fps: 30,
      browserSafe: false,
    })
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
})
