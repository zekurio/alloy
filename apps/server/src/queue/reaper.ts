import { and, eq, lt, sql } from "drizzle-orm"
import type { PgBoss } from "pg-boss"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { storage } from "../storage"
import { ENCODE_JOB } from "./encode-worker"

/**
 * Background sweeper for clip rows that fell out of the happy path.
 *
 *   - `pending` rows older than ~1h: the user opened initiate but never
 *     finalized. Delete the row and best-effort delete any partial
 *     bytes — the schema's `clip_status_idx` makes this scan cheap.
 *
 *   - `uploaded` rows older than ~24h: finalize succeeded but the
 *     encoder never picked the job up (server restart between finalize
 *     and the boss enqueue, e.g.). Re-enqueue rather than abandon.
 *
 * Scheduled via pg-boss's cron: every 10 minutes is dense enough that
 * the modal feedback feels live (a stuck row clears within a deploy
 * cycle) and rare enough that the scan never piles up.
 */

export const REAP_JOB = "clip.reap" as const

const PENDING_MAX_AGE_INTERVAL = "1 hour"
const UPLOADED_MAX_AGE_INTERVAL = "24 hours"

export async function registerReaperWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(REAP_JOB, {
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: 60 * 5,
  })

  await boss.work(REAP_JOB, async () => {
    await reapPending()
    await reuploadStuck(boss)
  })

  // Every 10 minutes. `boss.schedule` is idempotent — restarting the
  // server doesn't pile up duplicate cron entries.
  await boss.schedule(REAP_JOB, "*/10 * * * *")
}

async function reapPending(): Promise<void> {
  const stale = await db
    .select({ id: clip.id, storageKey: clip.storageKey })
    .from(clip)
    .where(
      and(
        eq(clip.status, "pending"),
        lt(
          clip.createdAt,
          sql`now() - interval '${sql.raw(PENDING_MAX_AGE_INTERVAL)}'`
        )
      )
    )

  for (const row of stale) {
    try {
      await storage.delete(row.storageKey)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[queue/reap] could not delete bytes for ${row.id}:`, err)
    }
    await db.delete(clip).where(eq(clip.id, row.id))
  }
  if (stale.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[queue/reap] removed ${stale.length} pending clip(s)`)
  }
}

async function reuploadStuck(boss: PgBoss): Promise<void> {
  const stuck = await db
    .select({ id: clip.id })
    .from(clip)
    .where(
      and(
        eq(clip.status, "uploaded"),
        lt(
          clip.createdAt,
          sql`now() - interval '${sql.raw(UPLOADED_MAX_AGE_INTERVAL)}'`
        )
      )
    )

  for (const row of stuck) {
    await boss.send(ENCODE_JOB, { clipId: row.id })
  }
  if (stuck.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[queue/reap] re-enqueued ${stuck.length} stuck encode(s)`)
  }
}
