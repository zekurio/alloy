import { and, eq, isNull, lt, or, sql } from "drizzle-orm"

import { clip, clipUploadTicket } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipRemove } from "../clips/events"
import { configStore } from "../config/store"
import { clipAssetKey, storage } from "../storage"
import { enqueueEncode } from "./encode-worker"

export const REAP_JOB = "clip.reap" as const

const UPLOADED_MAX_AGE_INTERVAL = "24 hours"
const REAP_INTERVAL_MS = 10 * 60 * 1000

let reaperTimer: NodeJS.Timeout | null = null
let reaperRunning = false

export async function startReaperWorker(): Promise<void> {
  if (reaperTimer) return
  reaperTimer = setInterval(() => {
    void runReaper()
  }, REAP_INTERVAL_MS)
  await runReaper()
}

export function stopReaperWorker(): void {
  if (!reaperTimer) return
  clearInterval(reaperTimer)
  reaperTimer = null
}

async function runReaper(): Promise<void> {
  if (reaperRunning) return
  reaperRunning = true
  try {
    await reapPending()
    await reapExpiredUploadTickets()
    await requeueStuckProcessing()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[queue/reap] failed:", err)
  } finally {
    reaperRunning = false
  }
}

async function reapPending(): Promise<void> {
  const pendingCutoff = new Date(
    Date.now() - configStore.get("limits").uploadTtlSec * 1000
  )
  const stale = await db
    .select({
      id: clip.id,
      authorId: clip.authorId,
      storageKey: clip.storageKey,
      thumbKey: clip.thumbKey,
    })
    .from(clip)
    .where(and(eq(clip.status, "pending"), lt(clip.createdAt, pendingCutoff)))

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

async function reapExpiredUploadTickets(): Promise<void> {
  const expiredTickets = await db
    .select({
      id: clipUploadTicket.id,
      clipId: clipUploadTicket.clipId,
      storageKey: clipUploadTicket.storageKey,
    })
    .from(clipUploadTicket)
    .where(
      and(
        isNull(clipUploadTicket.usedAt),
        lt(clipUploadTicket.expiresAt, new Date())
      )
    )

  for (const ticket of expiredTickets) {
    try {
      await storage.delete(ticket.storageKey)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[queue/reap] could not delete expired staged object ${ticket.storageKey}:`,
        err
      )
      continue
    }
    await db.delete(clipUploadTicket).where(eq(clipUploadTicket.id, ticket.id))
  }
}

async function requeueStuckProcessing(): Promise<void> {
  const stuck = await db
    .select({ id: clip.id })
    .from(clip)
    .where(
      and(
        or(
          eq(clip.status, "uploaded"),
          eq(clip.status, "encoding"),
          and(
            eq(clip.status, "ready"),
            lt(clip.encodeProgress, 100),
            isNull(clip.failureReason)
          )
        ),
        lt(
          clip.updatedAt,
          sql`now() - interval '${sql.raw(UPLOADED_MAX_AGE_INTERVAL)}'`
        )
      )
    )

  for (const row of stuck) {
    enqueueEncode(row.id)
  }
  if (stuck.length > 0) {
    // eslint-disable-next-line no-console
  }
}
