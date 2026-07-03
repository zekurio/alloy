import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { MEDIA_PIPELINE_VERSION } from "@alloy/server/media/pipeline-version"
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm"

import { enqueueClipMediaProcessing } from "./media-worker"

const logger = createLogger("queue")

const COMPLETION_POLL_MS = 10_000
/** Give up waiting on one clip after this long and move on. */
const COMPLETION_MAX_WAIT_MS = 3 * 60 * 60 * 1000

let backfillStarted = false
let backfillStopped = false

/**
 * Encode renditions for ready clips whose committed media wasn't produced by
 * the current pipeline — clips that predate renditions entirely (null
 * fingerprint) as well as clips whose renditions a since-deployed format
 * change left stale. Deliberately a trickle: one clip is re-enqueued at a
 * time and the next only after it finishes, so fresh uploads always win the
 * encode queue and a large library warms up over hours instead of
 * monopolizing the host. Clips stay `ready` (and playable from their
 * committed assets) throughout.
 */
export function startRenditionBackfill(): void {
  if (backfillStarted) return
  backfillStarted = true
  void runRenditionBackfill().catch((err) => {
    logger.error("rendition backfill failed:", err)
  })
}

export function stopRenditionBackfill(): void {
  backfillStopped = true
}

async function runRenditionBackfill(): Promise<void> {
  let afterId: string | null = null
  let scanned = 0
  let requeued = 0
  while (!backfillStopped) {
    const id = await nextBackfillClipId(afterId)
    if (!id) break
    afterId = id
    scanned += 1
    if (!(await markLeasable(id))) continue
    requeued += 1
    logger.info(`rendition backfill: re-encoding clip ${id}`)
    enqueueClipMediaProcessing(id)
    await waitForCompletion(id)
  }
  logger.info(
    `rendition backfill ${backfillStopped ? "stopped" : "complete"}: scanned ${scanned}, re-encoded ${requeued}`,
  )
}

async function nextBackfillClipId(
  afterId: string | null,
): Promise<string | null> {
  const [row] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(
      and(
        eq(clip.status, "ready"),
        isNotNull(clip.source_key),
        // Rows with a failure reason already burned their retries this run;
        // the next boot rescans them.
        isNull(clip.failure_reason),
        sql`${clip.encode_pipeline} is distinct from ${MEDIA_PIPELINE_VERSION}`,
        afterId ? gt(clip.id, afterId) : undefined,
      ),
    )
    .orderBy(clip.id)
    .limit(1)
  return row?.id ?? null
}

/**
 * Make a ready row leasable (`encode_progress < 100`) without touching its
 * status — playback keeps serving the committed source while the encode runs.
 * Skipped when another run currently holds the lease.
 */
async function markLeasable(id: string): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set({
      encode_progress: 0,
      encode_attempt: 0,
      failure_reason: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(clip.id, id),
        eq(clip.status, "ready"),
        isNull(clip.encode_run_id),
      ),
    )
    .returning({ id: clip.id })
  return Boolean(row)
}

async function waitForCompletion(id: string): Promise<void> {
  const deadline = Date.now() + COMPLETION_MAX_WAIT_MS
  while (!backfillStopped && Date.now() < deadline) {
    const [row] = await db
      .select({
        status: clip.status,
        encodeProgress: clip.encode_progress,
        failureReason: clip.failure_reason,
      })
      .from(clip)
      .where(eq(clip.id, id))
      .limit(1)
    if (!row) return
    if (row.status === "failed" || row.failureReason !== null) return
    if (row.encodeProgress >= 100) return
    await sleep(COMPLETION_POLL_MS)
  }
}

// Unref'd so a poll pause never keeps a stopping process alive; the loop
// re-checks `backfillStopped` on wake.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms).unref()
  })
}
