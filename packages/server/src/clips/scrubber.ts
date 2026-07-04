import { readFile } from "node:fs/promises"

import { createLogger } from "@alloy/logging"
import { generateScrubberSheet } from "@alloy/server/media/scrubber"
import { withClipSourceWorkDir } from "@alloy/server/queue/media-run-helpers"
import { join } from "@alloy/server/runtime/path"
import { clipAssetKey, clipThumbnailStorage } from "@alloy/server/storage/index"

const logger = createLogger("clips")

const pendingSheets = new Map<string, Promise<boolean>>()

export function clipScrubberKey(clipId: string): string {
  return clipAssetKey(clipId, "scrubber")
}

/**
 * Lazily materialize the trim-scrubber sprite sheet for a clip. The sheet is
 * derived from the immutable stored source under a deterministic key, so the
 * first editor visit generates it and every later visit serves the cached
 * object. Concurrent requests share one generation. Returns whether the
 * sheet exists afterwards.
 */
export function ensureClipScrubberSheet(input: {
  clipId: string
  sourceKey: string
  durationMs: number
}): Promise<boolean> {
  const key = clipScrubberKey(input.clipId)
  let pending = pendingSheets.get(key)
  if (!pending) {
    pending = generateSheet(key, input).finally(() => {
      pendingSheets.delete(key)
    })
    pendingSheets.set(key, pending)
  }
  return pending
}

export async function publishScrubberSheet(input: {
  clipId: string
  sourcePath: string
  workDir: string
  durationMs: number
  signal?: AbortSignal
}): Promise<void> {
  const sheetPath = join(input.workDir, "scrubber.jpg")
  await generateScrubberSheet(input.sourcePath, sheetPath, {
    durationMs: input.durationMs,
    signal: input.signal,
  })
  await clipThumbnailStorage.put(
    clipScrubberKey(input.clipId),
    await readFile(sheetPath),
    "image/jpeg",
  )
}

async function generateSheet(
  key: string,
  input: { clipId: string; sourceKey: string; durationMs: number },
): Promise<boolean> {
  if (await clipThumbnailStorage.resolve(key)) return true

  try {
    await withClipSourceWorkDir(
      `scrubber-${input.clipId}`,
      input.sourceKey,
      async ({ workDir, sourcePath }) => {
        await publishScrubberSheet({
          clipId: input.clipId,
          sourcePath,
          workDir,
          durationMs: input.durationMs,
        })
      },
    )
    return true
  } catch (err) {
    logger.warn(`scrubber sheet generation failed for ${input.clipId}:`, err)
    return false
  }
}
