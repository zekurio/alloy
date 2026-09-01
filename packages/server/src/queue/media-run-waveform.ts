import { extractWaveformAudio } from "@alloy/server/media/waveform-audio"
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
  existingKey: string | null
  signal: AbortSignal
  uploadedKeys: string[]
}): Promise<string | null> {
  if (!options.hasAudio) return null
  if (options.existingKey) return options.existingKey

  const outputPath = join(options.workDir, "waveform.m4a")
  await extractWaveformAudio({
    sourcePath: options.sourcePath,
    outputPath,
    durationMs: options.durationMs,
    signal: options.signal,
  })
  const key = runScopedWaveformKey(options.id, options.runId)
  options.uploadedKeys.push(key)
  await clipStorage.uploadFromFile(outputPath, key, "audio/mp4")
  return key
}
