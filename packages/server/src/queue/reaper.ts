import { clip, uploadTicket } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { publishClipRemove } from "@alloy/server/clips/events"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import {
  deleteStagedUpload,
  parseUploadTicketStorageState,
} from "@alloy/server/uploads/staged"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { and, eq, isNull, lt, or, sql } from "drizzle-orm"

import { enqueueClipMediaProcessing } from "./media-worker"

const logger = createLogger("queue")

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
    await reapPendingClips()
    await reapExpiredUploadTickets()
    await requeueStuckProcessing()
  } catch (err) {
    logger.error("reap pass failed:", err)
  } finally {
    reaperRunning = false
  }
}

function pendingCutoff(): Date {
  return new Date(Date.now() - configStore.get("limits").uploadTtlSec * 1000)
}

async function reapPendingClips(): Promise<void> {
  const stale = await db
    .select({ id: clip.id, authorId: clip.authorId })
    .from(clip)
    .where(and(eq(clip.status, "pending"), lt(clip.createdAt, pendingCutoff())))

  for (const row of stale) {
    await cleanupTickets(
      { type: "clip", id: row.id },
      `stale clip ${row.id} upload`,
    )
    await db.delete(clip).where(eq(clip.id, row.id))
    publishClipRemove(row.authorId, row.id)
  }
}

async function reapExpiredUploadTickets(): Promise<void> {
  // A ticket that expired without being consumed belongs to an upload that
  // never completed; finalize would reject it anyway, so drop object + row.
  const expiredTickets = await db
    .select({
      id: uploadTicket.id,
      storageKey: uploadTicket.storageKey,
      uploadState: uploadTicket.uploadState,
    })
    .from(uploadTicket)
    .where(
      and(isNull(uploadTicket.usedAt), lt(uploadTicket.expiresAt, new Date())),
    )

  for (const ticket of expiredTickets) {
    try {
      await deleteStagedUpload(
        ticket.storageKey,
        parseUploadTicketStorageState(ticket.uploadState),
      )
    } catch (err) {
      logger.warn(
        `could not delete expired staged object ${ticket.storageKey}:`,
        err,
      )
      continue
    }
    await db.delete(uploadTicket).where(eq(uploadTicket.id, ticket.id))
  }
}

async function requeueStuckProcessing(): Promise<void> {
  const stuckClips = await db
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
  for (const row of stuckClips) {
    enqueueClipMediaProcessing(row.id)
  }
}
