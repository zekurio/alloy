import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { moovPrecedesMdat } from "@alloy/server/media/faststart"
import { clipStorage } from "@alloy/server/storage/index"
import { and, eq, gt, isNotNull } from "drizzle-orm"

import { enqueueClipMediaProcessing } from "./media-worker"

const logger = createLogger("queue")

const PAGE_SIZE = 100

let fastStartBackfillStarted = false

export function startFastStartBackfill(): void {
  if (fastStartBackfillStarted) return
  fastStartBackfillStarted = true
  void runFastStartBackfill().catch((err) => {
    logger.error("faststart backfill failed:", err)
  })
}

async function runFastStartBackfill(): Promise<void> {
  const result = await scanFastStartPage(null, 0, 0)
  logger.info(
    `faststart backfill complete: scanned ${result.scanned}, re-enqueued ${result.requeued}`,
  )
}

async function scanFastStartPage(
  afterId: string | null,
  scanned: number,
  requeued: number,
): Promise<{ scanned: number; requeued: number }> {
  const rows = await db
    .select({
      id: clip.id,
      authorId: clip.author_id,
      sourceKey: clip.source_key,
    })
    .from(clip)
    .where(
      and(
        eq(clip.status, "ready"),
        isNotNull(clip.source_key),
        afterId ? gt(clip.id, afterId) : undefined,
      ),
    )
    .orderBy(clip.id)
    .limit(PAGE_SIZE)

  if (rows.length === 0) return { scanned, requeued }

  let pageRequeued = 0
  for (const row of rows) {
    try {
      if (await reenqueueIfNeedsFastStart(row)) pageRequeued += 1
    } catch (err) {
      logger.warn(`faststart backfill failed for clip ${row.id}:`, err)
    }
  }

  // Idempotent: remuxed clips pass the header check on later boots, so the
  // steady-state cost is tiny reads. Add a marker column if large libraries make
  // even that too expensive.
  return scanFastStartPage(
    rows[rows.length - 1]?.id ?? afterId,
    scanned + rows.length,
    requeued + pageRequeued,
  )
}

async function reenqueueIfNeedsFastStart(row: {
  id: string
  authorId: string
  sourceKey: string | null
}): Promise<boolean> {
  if (!row.sourceKey) return false

  const resolved = await clipStorage.resolve(row.sourceKey)
  if (!resolved) return false

  if (
    await moovPrecedesMdat(async (offset, length) => {
      return new Uint8Array(
        await new Response(
          resolved.stream({ start: offset, end: offset + length - 1 }),
        ).arrayBuffer(),
      )
    }, resolved.size)
  ) {
    return false
  }

  const [accepted] = await db
    .update(clip)
    .set({
      status: "processing",
      encode_progress: 0,
      encode_attempt: 0,
      failure_reason: null,
      updated_at: new Date(),
    })
    .where(and(eq(clip.id, row.id), eq(clip.status, "ready")))
    .returning({ id: clip.id })
  if (!accepted) return false

  void publishClipUpsert(row.authorId, row.id)
  enqueueClipMediaProcessing(row.id)
  return true
}
