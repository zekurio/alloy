import { readFile, rm } from "node:fs/promises"

import { createLogger } from "@alloy/logging"
import { generateScrubberSheet } from "@alloy/server/media/scrubber"
import { makeMediaWorkDir } from "@alloy/server/queue/media-run-helpers"
import { join } from "@alloy/server/runtime/path"
import {
  clipAssetKey,
  clipStorage,
  clipThumbnailStorage,
} from "@alloy/server/storage/index"

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

async function generateSheet(
  key: string,
  input: { clipId: string; sourceKey: string; durationMs: number },
): Promise<boolean> {
  if (await clipThumbnailStorage.resolve(key)) return true

  const workDir = await makeMediaWorkDir(`scrubber-${input.clipId}`)
  try {
    const sourcePath = join(workDir, "source")
    await clipStorage.downloadToFile(input.sourceKey, sourcePath)
    const sheetPath = join(workDir, "scrubber.jpg")
    await generateScrubberSheet(sourcePath, sheetPath, {
      durationMs: input.durationMs,
    })
    await clipThumbnailStorage.put(key, await readFile(sheetPath), "image/jpeg")
    return true
  } catch (err) {
    logger.warn(`scrubber sheet generation failed for ${input.clipId}:`, err)
    return false
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
