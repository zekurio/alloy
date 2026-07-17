import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { type ExtractedPoster, extractPoster } from "@alloy/server/media/poster"
import { probeMedia } from "@alloy/server/media/probe"
import { encodeExactCut } from "@alloy/server/media/trim"
import { join } from "@alloy/server/runtime/path"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"

import { abortMediaProcessing } from "./media-abort"
import { runScopedThumbKey } from "./media-asset-keys"
import type { MediaRow, MediaStore } from "./media-store"

const logger = createLogger("queue")

/**
 * Ingest-time trims (from /initiate) are validated only against the
 * client-declared duration, so clamp against the probed reality here. A
 * start beyond the media is a hard failure — silently publishing footage the
 * uploader asked to cut would be worse than a failed clip.
 */
export function trimRange(
  row: Pick<MediaRow, "trimStartMs" | "trimEndMs">,
  sourceDurationMs: number,
): { startMs: number; endMs: number } | null {
  if (row.trimStartMs == null || row.trimEndMs == null) return null
  if (row.trimStartMs >= sourceDurationMs) {
    throw new Error("The trim range lies outside the media duration")
  }
  const endMs = Math.min(row.trimEndMs, sourceDurationMs)
  if (endMs <= row.trimStartMs) return null
  return { startMs: row.trimStartMs, endMs }
}

export async function materializeEffectiveMedia(
  store: MediaStore,
  id: string,
  row: MediaRow,
  runId: string,
  options: { workDir: string; signal: AbortSignal },
): Promise<{ path: string; durationMs: number }> {
  if (!(await store.commitStage(id, runId, "downloading"))) {
    throw abortMediaProcessing()
  }
  const mediaPath = join(options.workDir, "media.mp4")
  if (row.cutKey) {
    await clipStorage.downloadToFile(row.cutKey, mediaPath)
    return {
      path: mediaPath,
      durationMs:
        row.durationMs ??
        row.sourceDurationMs ??
        (await probeMedia(mediaPath)).durationMs,
    }
  }

  if (!row.sourceKey) throw new Error("Clip is missing source media")
  const sourcePath = join(options.workDir, "source")
  await clipStorage.downloadToFile(row.sourceKey, sourcePath)

  const sourceDurationMs =
    row.sourceDurationMs ?? (await probeMedia(sourcePath)).durationMs
  const trim = trimRange(row, sourceDurationMs)
  if (!trim) {
    return {
      path: sourcePath,
      durationMs: row.durationMs ?? sourceDurationMs,
    }
  }

  // Defensive path for legacy trimmed rows without a committed cut: rebuild
  // the exact cut so poster frames come from the footage the owner kept.
  const sourceProbe = await probeMedia(sourcePath)
  const cut = await encodeExactCut({
    sourcePath,
    outDir: join(options.workDir, "cut"),
    config: configStore.get("transcoding"),
    source: sourceProbe,
    startMs: trim.startMs,
    endMs: trim.endMs,
    signal: options.signal,
  })
  return {
    path: cut.filePath,
    durationMs: row.durationMs ?? cut.durationMs,
  }
}

export async function extractPosterBestEffort(
  mediaPath: string,
  workDir: string,
  options: { durationMs: number; signal: AbortSignal },
): Promise<
  | { kind: "thumbnail"; poster: ExtractedPoster }
  | { kind: "permanent-empty" }
  | { kind: "transient-error" }
> {
  try {
    const poster = await extractPoster(mediaPath, workDir, options)
    return poster ? { kind: "thumbnail", poster } : { kind: "permanent-empty" }
  } catch (err) {
    if (options.signal.aborted) throw err
    logger.warn(`poster extraction failed transiently for ${mediaPath}:`, err)
    return { kind: "transient-error" }
  }
}

export async function publishRunThumbnail(
  id: string,
  runId: string,
  poster: ExtractedPoster,
  uploadedKeys: string[],
): Promise<{ thumbKey: string; thumbBlurHash: string }> {
  const thumbKey = runScopedThumbKey(id, runId)
  await clipThumbnailStorage.put(thumbKey, poster.jpeg, "image/jpeg")
  uploadedKeys.push(thumbKey)
  return { thumbKey, thumbBlurHash: poster.blurHash }
}
