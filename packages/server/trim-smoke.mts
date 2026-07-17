import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TranscodingConfigSchema } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"

import { runFfmpeg } from "./src/media/ffmpeg"
import { probeMedia } from "./src/media/probe"
import { encodeExactCut } from "./src/media/trim"

const logger = createLogger("trim-smoke")
const workDir = await mkdtemp(join(tmpdir(), "alloy-trim-smoke-"))
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
      // Sparse keyframes (0s/3s/6s/9s) so a keyframe-snapped copy of the
      // 2.5s..6.5s range would be visibly wrong; the exact cut must not be.
      "-g",
      "90",
      "-c:a",
      "aac",
      "-shortest",
      sourcePath,
    ],
  })
  const cut = await encodeExactCut({
    sourcePath,
    outDir: join(workDir, "cut"),
    config: TranscodingConfigSchema.parse({}),
    source: await probeMedia(sourcePath),
    startMs: 2500,
    endMs: 6500,
  })
  const probed = await probeMedia(cut.filePath)
  logger.info("cut:", probed)
  if (Math.abs(probed.durationMs - 4000) > 150)
    throw new Error("cut is not frame-exact")
  if (probed.videoCodec !== "h264" || probed.audioCodec !== "aac")
    throw new Error("cut is not H.264/AAC")
  if (probed.height !== 360 || probed.width !== 640)
    throw new Error("cut changed the source resolution")
  logger.info("trim smoke OK")
} finally {
  await rm(workDir, { recursive: true, force: true })
}
