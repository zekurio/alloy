import { clip } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { and, eq, lt } from "drizzle-orm"

import { publishClipProgress } from "../clips/events"
import { db } from "../db"

export function makeMediaProgressWriter(
  clipId: string,
  authorId: string,
  runId: string,
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
      .where(
        and(
          eq(clip.id, clipId),
          eq(clip.encodeRunId, runId),
          lt(clip.encodeProgress, pct),
        ),
      )
      .returning({ id: clip.id })
      .then((rows) => {
        if (rows.length > 0) publishClipProgress(authorId, clipId, pct)
      })
      .catch((err: unknown) => {
        logger.error(
          `[media-worker] progress update failed for ${clipId}:`,
          err,
        )
      })
  }
}
