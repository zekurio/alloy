import { eq } from "drizzle-orm"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipProgress } from "../lib/clip-events"

export function makeProgressWriter(
  clipId: string,
  authorId: string
): (pct: number) => void {
  let lastWrittenPct = 0
  let lastWriteAt = 0
  return (pct: number) => {
    const now = Date.now()
    if (pct <= lastWrittenPct) return
    if (now - lastWriteAt < 2000 && pct < 99) return
    lastWrittenPct = pct
    lastWriteAt = now
    db.update(clip)
      .set({ encodeProgress: pct, updatedAt: new Date() })
      .where(eq(clip.id, clipId))
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          `[encode-worker] progress update failed for ${clipId}:`,
          err
        )
      })
    publishClipProgress(authorId, clipId, pct)
  }
}
