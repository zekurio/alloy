import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runFfmpeg } from "./src/media/ffmpeg"
import { probeMedia } from "./src/media/probe"
import { trimToMp4 } from "./src/media/trim"

const workDir = await mkdtemp(join(tmpdir(), "alloy-trim-smoke-"))
try {
  const sourcePath = join(workDir, "source.mp4")
  await runFfmpeg({
    timeoutMs: 120_000,
    args: [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=10",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-g", "30",
      "-c:a", "aac", "-shortest", sourcePath,
    ],
  })
  const outPath = join(workDir, "trimmed.mp4")
  await trimToMp4(sourcePath, outPath, { startMs: 2000, endMs: 6000 })
  const probed = await probeMedia(outPath)
  console.log("trimmed:", probed)
  if (Math.abs(probed.durationMs - 4000) > 1200) throw new Error("unexpected trim duration")
  if (probed.videoCodec !== "h264" || probed.audioCodec !== "aac") throw new Error("stream copy changed codecs")
  console.log("trim smoke OK")
} finally {
  await rm(workDir, { recursive: true, force: true })
}
