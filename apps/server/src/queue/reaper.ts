import { clip, clipUploadTicket } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { and, eq, isNull, lt, or, sql } from "drizzle-orm"

import { publishClipRemove } from "../clips/events"
import { configStore } from "../config/store"
import { db } from "../db"
import { deleteScratchUpload, deleteScratchUploads } from "../uploads/scratch"
import { enqueueEncode } from "./encode-worker"

const UPLOADED_MAX_AGE_INTERVAL = "24 hours"
const REAP_INTERVAL_MS = 10 * 60 * 1000

let reaperTimer: ReturnType<typeof setInterval> | null = null
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
    logger.error("[queue/reap] failed:", err)
  } finally {
    reaperRunning = false
  }
}

async function reapPending(): Promise<void> {
  const pendingCutoff = new Date(
    Date.now() - configStore.get("limits").uploadTtlSec * 1000,
  )
  const stale = await db
    .select({
      id: clip.id,
      authorId: clip.authorId,
    })
    .from(clip)
    .where(and(eq(clip.status, "pending"), lt(clip.createdAt, pendingCutoff)))

  for (const row of stale) {
    const tickets = await db
      .select({ storageKey: clipUploadTicket.storageKey })
      .from(clipUploadTicket)
      .where(eq(clipUploadTicket.clipId, row.id))
    await deleteScratchUploads(
      tickets.map((ticket) => ticket.storageKey),
      `stale clip ${row.id} upload`,
    )
    await db.delete(clip).where(eq(clip.id, row.id))
    publishClipRemove(row.authorId, row.id)
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
    .innerJoin(clip, eq(clip.id, clipUploadTicket.clipId))
    .where(
      and(
        isNull(clipUploadTicket.usedAt),
        eq(clip.status, "pending"),
        lt(clipUploadTicket.expiresAt, new Date()),
      ),
    )

  for (const ticket of expiredTickets) {
    try {
      await deleteScratchUpload(ticket.storageKey)
    } catch (err) {
      logger.warn(
        `[queue/reap] could not delete expired staged object ${ticket.storageKey}:`,
        err,
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
          eq(clip.status, "processing"),
          and(
            eq(clip.status, "ready"),
            lt(clip.encodeProgress, 100),
            isNull(clip.failureReason),
          ),
        ),
        lt(
          clip.updatedAt,
          sql`now() - interval '${sql.raw(UPLOADED_MAX_AGE_INTERVAL)}'`,
        ),
      ),
    )

  for (const row of stuck) {
    enqueueEncode(row.id)
  }
}
