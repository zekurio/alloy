import { runFfmpeg, transcodeTimeoutMs } from "@alloy/server/media/ffmpeg"
import { join } from "@alloy/server/runtime/path"
import { clipStorage } from "@alloy/server/storage/index"

import { runScopedWaveformKey } from "./media-asset-keys"

/** Generate the owner-editor waveform asset once; trims keep the same source. */
export async function resolveWaveformAudio(options: {
  id: string
  runId: string
  sourcePath: string
  workDir: string
  durationMs: number
  hasAudio: boolean
  signal: AbortSignal
  uploadedKeys: string[]
}): Promise<string | null> {
  if (!options.hasAudio) return null

  const outputPath = join(options.workDir, "waveform.m4a")
  await runFfmpeg({
    args: [
      "-y",
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
  options.uploadedKeys.push(key)
  await clipStorage.uploadFromFile(outputPath, key, "audio/mp4")
  return key
}
