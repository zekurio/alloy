import { join } from "node:path"

import { runFfmpeg, transcodeTimeoutMs } from "@alloy/server/media/ffmpeg"
import { clipStorage } from "@alloy/server/storage/index"

import { runScopedWaveformKey } from "./media-asset-keys"
import type { RunUploads } from "./media-run-workspace"

/** Generate the owner-editor waveform asset once; trims keep the same source. */
export async function resolveWaveformAudio(options: {
  id: string
  runId: string
  sourcePath: string
  workDir: string
  durationMs: number
  hasAudio: boolean
  signal: AbortSignal
  uploadedKeys: RunUploads
}): Promise<string | null> {
  if (!options.hasAudio) return null

  const outputPath = join(options.workDir, "waveform.m4a")
  await runFfmpeg({
    args: [
      "-i",
      options.sourcePath,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "22050",
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    timeoutMs: transcodeTimeoutMs(options.durationMs),
    signal: options.signal,
  })
  const key = runScopedWaveformKey(options.id, options.runId)
  await options.uploadedKeys.reserve(key)
  await clipStorage.uploadFromFile(outputPath, key, "audio/mp4")
  return key
}
