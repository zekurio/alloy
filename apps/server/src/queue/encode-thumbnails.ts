import { promises as fsp } from "node:fs"
import path from "node:path"

import { storage } from "../storage"
import { thumbnail } from "./ffmpeg"

export async function ensureThumbnails({
  clipId,
  sourcePath,
  thumbPath,
  thumbSmallPath,
  thumbKey,
  thumbSmallKey,
  effectiveTrimStart,
  effectiveTrimEnd,
  durationMs,
}: {
  clipId: string
  sourcePath: string
  thumbPath: string
  thumbSmallPath: string
  thumbKey: string
  thumbSmallKey: string
  effectiveTrimStart: number | null
  effectiveTrimEnd: number | null
  durationMs: number
}): Promise<boolean> {
  try {
    const [thumbHit, thumbSmallHit] = await Promise.all([
      storage.resolve(thumbKey),
      storage.resolve(thumbSmallKey),
    ])
    if (thumbHit && thumbSmallHit) return true

    await fsp.mkdir(path.dirname(thumbPath), { recursive: true })
    const baseSec = (effectiveTrimStart ?? 0) / 1000
    const thumbAt = Math.min(
      baseSec + 1,
      Math.max(0, (effectiveTrimEnd ?? durationMs) / 1000 - 0.1)
    )
    if (!thumbHit) {
      await thumbnail(sourcePath, thumbPath, { width: 640, atSeconds: thumbAt })
    }
    if (!thumbSmallHit) {
      await thumbnail(sourcePath, thumbSmallPath, {
        width: 160,
        atSeconds: thumbAt,
      })
    }
    return true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[queue] thumbnail generation failed for ${clipId}:`, err)
    return false
  }
}
