import { runFfmpeg, transcodeTimeoutMs } from "@alloy/server/media/ffmpeg"
import { join } from "@alloy/server/runtime/path"
import { clipStorage } from "@alloy/server/storage/index"

import { abortMediaProcessing } from "./media-abort"
import { runScopedWaveformKey } from "./media-asset-keys"
import { acquireSourceFile } from "./media-run-source"
import {
  ensureStillPresent,
  withMediaRunWorkspace,
} from "./media-run-workspace"
import type { MediaCompletion, MediaRow, MediaStore } from "./media-store"

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

export async function runWaveformBackfill(
  store: MediaStore,
  id: string,
  row: MediaRow,
  runId: string,
  signal: AbortSignal,
  completion: MediaCompletion,
): Promise<void> {
  if (!row.sourceAudioCodec) {
    if (!(await store.commitWaveform(id, runId, null, completion))) {
      throw abortMediaProcessing()
    }
    store.publishUpsert(row.authorId, id)
    return
  }

  const sourceContentType = row.sourceContentType
  const sourceDurationMs = row.sourceDurationMs
  if (sourceContentType !== "video/mp4") {
    throw new Error("Recording is missing source content type")
  }
  if (!sourceDurationMs || sourceDurationMs <= 0) {
    throw new Error("Recording is missing source duration")
  }

  await withMediaRunWorkspace(
    { store, id, runId, row, cleanupLabel: "waveform" },
    async (workspace) => {
      const sourcePath = await acquireSourceFile({
        store,
        id,
        runId,
        row,
        sourceContentType,
        workDir: workspace.workDir,
        signal,
      })
      await ensureStillPresent(store, id, runId, signal)

      const waveformKey = await resolveWaveformAudio({
        id,
        runId,
        sourcePath,
        workDir: workspace.workDir,
        durationMs: sourceDurationMs,
        hasAudio: true,
        signal,
        uploadedKeys: workspace.uploadedKeys,
      })
      if (!waveformKey) throw new Error("Recording has no audio")
      if (!(await store.commitWaveform(id, runId, waveformKey, completion))) {
        throw abortMediaProcessing()
      }
      workspace.retainedKeys.add(waveformKey)
      store.publishUpsert(row.authorId, id)
    },
  )
}
