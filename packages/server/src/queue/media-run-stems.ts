import { rm } from "node:fs/promises"

import type { ClipAudioTrackInput } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { extractAudioStems } from "@alloy/server/media/audio-stems"
import type { MediaAudioProbe } from "@alloy/server/media/probe"
import { clipStorage } from "@alloy/server/storage/index"

import { runScopedAudioTrackKey } from "./media-asset-keys"
import {
  deleteAssetsBestEffort,
  ensureStillPresent,
} from "./media-run-workspace"
import type { MediaAudioTrackRecord, MediaRow, MediaStore } from "./media-store"

const logger = createLogger("queue")

export async function extractAndUploadAudioStemsBestEffort(options: {
  store: MediaStore
  id: string
  runId: string
  signal: AbortSignal
  sourcePath: string
  outDir: string
  sourceTracks: readonly MediaAudioProbe[]
  hints: readonly ClipAudioTrackInput[]
  trim?: { startMs: number; endMs: number }
  canonicalDurationMs: number
  uploadedKeys: string[]
  onProgress: (fraction: number) => void
}): Promise<MediaAudioTrackRecord[]> {
  if (options.hints.length === 0) return []

  await ensureStillPresent(
    options.store,
    options.id,
    options.runId,
    options.signal,
  )
  const extracted = await extractStemsBestEffort(options)
  if (!extracted) return []

  const audioTracks: MediaAudioTrackRecord[] = []
  for (const stem of extracted) {
    await ensureStillPresent(
      options.store,
      options.id,
      options.runId,
      options.signal,
    )
    const storageKey = runScopedAudioTrackKey(
      options.id,
      options.runId,
      stem.index,
    )
    const uploaded = await uploadAudioStemBestEffort(
      options.id,
      stem.filePath,
      storageKey,
      options.signal,
    )
    if (!uploaded) {
      await deleteAssetsBestEffort(
        [...audioTracks.map((track) => track.storageKey), storageKey],
        "incomplete audio stem",
      )
      return []
    }

    options.uploadedKeys.push(storageKey)
    await rm(stem.filePath, { force: true }).catch(() => undefined)
    audioTracks.push({
      index: stem.index,
      kind: stem.kind,
      label: stem.label,
      storageKey,
      codecs: stem.codecs,
      sizeBytes: stem.sizeBytes,
    })
  }
  return audioTracks
}

async function extractStemsBestEffort(
  options: Parameters<typeof extractAndUploadAudioStemsBestEffort>[0],
) {
  try {
    return await extractAudioStems({
      sourcePath: options.sourcePath,
      outDir: options.outDir,
      sourceTracks: options.sourceTracks,
      hints: options.hints,
      trim: options.trim,
      canonicalDurationMs: options.canonicalDurationMs,
      signal: options.signal,
      onProgress: options.onProgress,
    })
  } catch (err) {
    if (options.signal.aborted) throw err
    logger.warn(`audio stem extraction failed for ${options.id}:`, err)
    return null
  }
}

async function uploadAudioStemBestEffort(
  clipId: string,
  filePath: string,
  storageKey: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await clipStorage.uploadFromFile(filePath, storageKey, "audio/mp4")
    return true
  } catch (err) {
    if (signal.aborted) throw err
    logger.warn(`audio stem upload failed for ${clipId}:`, err)
    return false
  }
}

export function validatedAudioTrackHints(
  row: MediaRow,
  probedAudioTrackCount: number,
) {
  if (row.pendingAudioTracks === null) return []
  const hints = row.pendingAudioTracks
  const expectedHintCount = Math.max(0, probedAudioTrackCount - 1)
  if (hints.length === expectedHintCount) return hints
  logger.warn(
    `discarding audio stem hints for ${row.id}: expected ${expectedHintCount}, received ${hints.length}`,
  )
  return []
}
