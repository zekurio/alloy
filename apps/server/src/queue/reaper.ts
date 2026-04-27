import { and, eq, lt, or, sql } from "drizzle-orm"
import type { PgBoss } from "pg-boss"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipRemove } from "../lib/clip-events"
import { clipAssetKey, storage } from "../storage"
import { ENCODE_JOB } from "./encode-worker"

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
    await requeueStuckProcessing(boss)
  })

  // Every 10 minutes. `boss.schedule` is idempotent — restarting the
  // server doesn't pile up duplicate cron entries.
  await boss.schedule(REAP_JOB, "*/10 * * * *")
}

async function reapPending(): Promise<void> {
  const stale = await db
    .select({
      id: clip.id,
      authorId: clip.authorId,
      storageKey: clip.storageKey,
      thumbKey: clip.thumbKey,
    })
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
    const keys = [row.storageKey, row.thumbKey ?? clipAssetKey(row.id, "thumb")]
    for (const key of keys) {
      try {
        await storage.delete(key)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[queue/reap] could not delete bytes for ${row.id}:`, err)
      }
    }
    await db.delete(clip).where(eq(clip.id, row.id))
    publishClipRemove(row.authorId, row.id)
  }
  if (stale.length > 0) {
    // eslint-disable-next-line no-console
  }
}

async function requeueStuckProcessing(boss: PgBoss): Promise<void> {
  const stuck = await db
    .select({ id: clip.id })
    .from(clip)
    .where(
      and(
        or(
          eq(clip.status, "uploaded"),
          and(eq(clip.status, "ready"), lt(clip.encodeProgress, 100))
        ),
        lt(
          clip.updatedAt,
          sql`now() - interval '${sql.raw(UPLOADED_MAX_AGE_INTERVAL)}'`
        )
      )
    )

  for (const row of stuck) {
    await boss.send(ENCODE_JOB, { clipId: row.id })
  }
  if (stuck.length > 0) {
    // eslint-disable-next-line no-console
  }
}
