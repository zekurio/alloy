import { rm } from "node:fs/promises"

import type { TranscodingConfig } from "@alloy/contracts"
import {
  encodeRenditionWithFallback,
  type LadderStep,
} from "@alloy/server/media/renditions"
import { encodeExactCut } from "@alloy/server/media/trim"
import { join } from "@alloy/server/runtime/path"
import { clipStorage } from "@alloy/server/storage/index"

import { abortMediaProcessing } from "./media-abort"
import { runScopedCutKey, runScopedRenditionKey } from "./media-asset-keys"
import {
  encodeTierCost,
  type EncodeProgressTracker,
} from "./media-encode-progress"
import { ensureStillPresent } from "./media-run-workspace"
import type { MediaRenditionRecord, MediaStore } from "./media-store"

/**
 * Encode and upload the frame-exact H.264 cut for a trimmed clip. The cut is
 * the clip's canonical playback media and the poster source; without a trim
 * the original source fills both roles.
 */
export async function encodeAndPublishCut(options: {
  id: string
  runId: string
  workDir: string
  sourcePath: string
  config: TranscodingConfig
  source: { width: number; height: number; fps: number | null }
  trim: { startMs: number; endMs: number } | null
  signal: AbortSignal
  uploadedKeys: string[]
  onHardwareFailed: () => void
}): Promise<{
  key: string | null
  durationMs: number | null
  codecs: string | null
  posterMediaPath: string
}> {
  if (!options.trim) {
    return {
      key: null,
      durationMs: null,
      codecs: null,
      posterMediaPath: options.sourcePath,
    }
  }
  const cut = await encodeExactCut({
    sourcePath: options.sourcePath,
    outDir: join(options.workDir, "cut"),
    config: options.config,
    source: options.source,
    startMs: options.trim.startMs,
    endMs: options.trim.endMs,
    signal: options.signal,
    onHardwareFailed: options.onHardwareFailed,
  })
  const cutKey = runScopedCutKey(options.id, options.runId)
  await clipStorage.uploadFromFile(cut.filePath, cutKey, "video/mp4")
  options.uploadedKeys.push(cutKey)
  return {
    key: cutKey,
    durationMs: cut.durationMs,
    // Probe-derived; empty when the codec string could not be built.
    codecs: cut.codecs || null,
    posterMediaPath: cut.filePath,
  }
}

/**
 * Encode the ladder from the original source and upload each rendition under
 * a run-scoped key; the keys stay unpublished until commitReady.
 */
export async function encodeAndUploadRenditions(options: {
  store: MediaStore
  id: string
  runId: string
  signal: AbortSignal
  workDir: string
  sourcePath: string
  ladder: readonly LadderStep[]
  config: TranscodingConfig
  trim?: { startMs: number; endMs: number }
  durationMs: number
  hardwareFailed: boolean
  uploadedKeys: string[]
  progress: EncodeProgressTracker
}): Promise<MediaRenditionRecord[]> {
  let hardwareFailed = options.hardwareFailed
  const renditions: MediaRenditionRecord[] = []
  for (const step of options.ladder) {
    await ensureStillPresent(
      options.store,
      options.id,
      options.runId,
      options.signal,
    )
    const tierCost = encodeTierCost(step)
    if (
      !(await options.store.commitStage(options.id, options.runId, "encoding", {
        name: step.name,
        index: renditions.length + 1,
        count: options.ladder.length,
      }))
    )
      throw abortMediaProcessing()
    const encodeConfig =
      hardwareFailed || options.config.hardwareAcceleration === "none"
        ? { ...options.config, hardwareAcceleration: "none" as const }
        : options.config
    const encoded = await encodeRenditionWithFallback({
      srcPath: options.sourcePath,
      trim: options.trim,
      outDir: join(options.workDir, `rendition-${step.name}`),
      config: encodeConfig,
      step,
      durationMs: options.durationMs,
      signal: options.signal,
      onProgress: (fraction) => options.progress.writeAt(tierCost, fraction),
      onHardwareFailed: () => {
        hardwareFailed = true
      },
    })
    const renditionKey = runScopedRenditionKey(
      options.id,
      options.runId,
      step.name,
    )
    await clipStorage.uploadFromFile(
      encoded.filePath,
      renditionKey,
      "video/mp4",
    )
    options.uploadedKeys.push(renditionKey)
    await rm(encoded.filePath, { force: true }).catch(() => undefined)
    renditions.push({
      name: step.name,
      isOg: step.og,
      height: encoded.height,
      width: encoded.width,
      fps: encoded.fps,
      storageKey: renditionKey,
      codecs: encoded.codecs,
      sizeBytes: encoded.sizeBytes,
    })
    options.progress.complete(tierCost)
  }
  return renditions
}
