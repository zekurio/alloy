import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { TranscodingConfigSchema } from "@alloy/contracts"

import { runFfmpeg } from "./ffmpeg"
import { probeMedia } from "./probe"
import { transcodeSettings } from "./transcode-settings"
import { encodeExactCut } from "./trim"

const FULL_CONFIG = TranscodingConfigSchema.parse({})
const ffmpegAvailable =
  spawnSync(transcodeSettings().ffmpegPath, ["-version"], { stdio: "ignore" })
    .status === 0 &&
  spawnSync(transcodeSettings().ffprobePath, ["-version"], { stdio: "ignore" })
    .status === 0

test(
  "encodeExactCut re-encodes a frame-exact H.264/AAC cut at source shape",
  { skip: !ffmpegAvailable && "ffmpeg/ffprobe not available on PATH" },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "alloy-trim-test-"))
    try {
      const sourcePath = join(workDir, "source.mp4")
      // Keyframes only at 0s/3s/6s/9s: a keyframe-snapped packet copy of the
      // 2.5s..6.5s range would start at 0s and run ~6.5s. The exact cut must
      // hit the requested 4s regardless of keyframe placement.
      await runFfmpeg({
        timeoutMs: 120_000,
        args: [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=640x360:rate=30:duration=10",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=10",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "-g",
          "90",
          "-sc_threshold",
          "0",
          "-c:a",
          "aac",
          "-shortest",
          sourcePath,
        ],
      })

      const cut = await encodeExactCut({
        sourcePath,
        outDir: join(workDir, "cut"),
        config: FULL_CONFIG,
        source: await probeMedia(sourcePath),
        startMs: 2500,
        endMs: 6500,
      })

      assert.ok(
        Math.abs(cut.durationMs - 4000) <= 150,
        `cut duration ${cut.durationMs}ms is not frame-exact`,
      )
      assert.ok(cut.codecs.startsWith("avc1."))
      assert.ok(cut.codecs.endsWith(",mp4a.40.2"))

      const probed = await probeMedia(cut.filePath)
      assert.equal(probed.videoCodec, "h264")
      assert.equal(probed.audioCodec, "aac")
      assert.equal(probed.width, 640)
      assert.equal(probed.height, 360)
      assert.equal(Math.round(probed.fps ?? 0), 30)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)
