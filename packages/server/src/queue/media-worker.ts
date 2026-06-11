import { clip, clipUploadTicket } from "@alloy/db/schema"
import { logger } from "@alloy/logging"
import { publishClipUpsertById } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { requiredSql } from "@alloy/server/db/sql"
import { createNotification } from "@alloy/server/notifications/index"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"
import { deleteScratchUploads } from "@alloy/server/uploads/scratch"
import { and, eq, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm"

import { runMediaProcessingInner } from "./media-processing-run"

const RETRY_LIMIT = 2
const ENCODE_LEASE_STALE_INTERVAL = "2 minutes"
const ENCODE_LEASE_HEARTBEAT_MS = 30_000
const RETRY_DELAY_INTERVAL = "30 seconds"
const POLL_INTERVAL_MS = 5000

const activeMediaJobs = new Map<
  string,
  { abort: AbortController; done: Promise<void> }
>()
const queuedClipIds = new Set<string>()
const inFlightClipIds = new Set<string>()
const runningJobs = new Set<Promise<void>>()
let wakeTimer: ReturnType<typeof setTimeout> | null = null
let pumpPromise: Promise<void> | null = null
let started = false
let stopping = false

export async function cancelClipMediaProcessing(clipId: string): Promise<void> {
  const entry = activeMediaJobs.get(clipId)
  if (!entry) return
  entry.abort.abort()
  await entry.done
}

export function enqueueClipMediaProcessing(clipId: string): void {
  queuedClipIds.add(clipId)
  schedulePump(0)
}

export async function startClipMediaWorker(): Promise<void> {
  if (started) return
  started = true
  stopping = false
  schedulePump(0)
}

export async function stopClipMediaWorker(): Promise<void> {
  if (!started) return
  started = false
  stopping = true
  if (wakeTimer) {
    clearTimeout(wakeTimer)
    wakeTimer = null
  }
  for (const entry of activeMediaJobs.values()) {
    entry.abort.abort()
  }
  await Promise.allSettled(runningJobs)
}

function schedulePump(delayMs: number): void {
  if (!started || stopping) return
  if (wakeTimer && delayMs > 0) return
  if (wakeTimer) clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    void pump()
  }, delayMs)
}

async function pump(): Promise<void> {
  if (pumpPromise) return pumpPromise
  pumpPromise = pumpInner()
    .catch((err) => {
      logger.error("[queue] clip media worker pump failed:", err)
      schedulePump(POLL_INTERVAL_MS)
    })
    .finally(() => {
      pumpPromise = null
    })
  return pumpPromise
}

async function pumpInner(): Promise<void> {
  // No concurrency cap: durable media processing is expected to be rare, so we
  // start every pending clip as we find it.
  // `processClip` adds the id to `inFlightClipIds` synchronously, so the next
  // `nextClipId()` won't hand back a clip that's already encoding.
  while (started && !stopping) {
    const clipId = await nextClipId()
    if (!started || stopping) return
    if (!clipId) {
      schedulePump(POLL_INTERVAL_MS)
      return
    }
    const job = processClip(clipId)
    runningJobs.add(job)
    job.finally(() => {
      runningJobs.delete(job)
      schedulePump(0)
    })
  }
}

async function nextClipId(): Promise<string | null> {
  for (const queued of queuedClipIds) {
    queuedClipIds.delete(queued)
    if (!inFlightClipIds.has(queued)) return queued
  }

  const rows = await db
    .select({ id: clip.id })
    .from(clip)
    .where(
      and(
        ...encodeLeaseConditions(),
        or(
          isNull(clip.failureReason),
          lt(
            clip.updatedAt,
            sql`now() - interval '${sql.raw(RETRY_DELAY_INTERVAL)}'`,
          ),
        ),
      ),
    )
    .orderBy(clip.updatedAt)
    // We start one clip per loop turn, so we only need enough rows to skip
    // past the ones already encoding and find the next free candidate.
    .limit(inFlightClipIds.size + 1)

  return rows.find((row) => !inFlightClipIds.has(row.id))?.id ?? null
}

async function processClip(clipId: string): Promise<void> {
  inFlightClipIds.add(clipId)
  try {
    await runClipMediaProcessing(clipId)
  } catch (err) {
    if (isAbortError(err)) return
    logger.error(`[queue] clip media job failed for ${clipId}:`, err)
  } finally {
    inFlightClipIds.delete(clipId)
  }
}

async function runClipMediaProcessing(clipId: string): Promise<void> {
  const runId = crypto.randomUUID()
  const [row] = await db
    .update(clip)
    .set({
      status: "processing",
      encodeRunId: runId,
      encodeLockedAt: new Date(),
      encodeAttempt: sql`${clip.encodeAttempt} + 1`,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), ...encodeLeaseConditions()))
    .returning()
  if (!row) return

  const abort = new AbortController()
  let resolveDone: () => void = () => undefined
  const done = new Promise<void>((r) => {
    resolveDone = r
  })
  activeMediaJobs.set(clipId, { abort, done })
  const stopHeartbeat = startEncodeLeaseHeartbeat(clipId, runId, abort)

  try {
    await runMediaProcessingInner(clipId, row, runId, abort.signal)
  } catch (err) {
    if (isAbortError(err)) {
      if (stopping) {
        await releaseEncodeLease(
          clipId,
          runId,
          "Clip media processing interrupted by shutdown",
        )
      }
    } else {
      const reason = errorMessage(err, "Clip media processing failed")
      if (row.encodeAttempt > RETRY_LIMIT) {
        await markFailedUnlessReady(clipId, reason)
      } else {
        await releaseEncodeLease(clipId, runId, reason)
      }
    }
    throw err
  } finally {
    stopHeartbeat()
    activeMediaJobs.delete(clipId)
    resolveDone()
  }
}

function startEncodeLeaseHeartbeat(
  clipId: string,
  runId: string,
  abort: AbortController,
): () => void {
  let pending = false
  const beat = () => {
    if (pending || abort.signal.aborted) return
    pending = true
    db.update(clip)
      .set({ encodeLockedAt: new Date() })
      .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
      .returning({ id: clip.id })
      .then((rows) => {
        if (rows.length === 0) abort.abort()
      })
      .catch((err: unknown) => {
        logger.error(
          `[queue] encode lease heartbeat failed for ${clipId}:`,
          err,
        )
      })
      .finally(() => {
        pending = false
      })
  }
  const timer = setInterval(beat, ENCODE_LEASE_HEARTBEAT_MS)
  return () => clearInterval(timer)
}

function encodeLeaseConditions(): [SQL, SQL] {
  return [
    requiredSql(
      or(
        eq(clip.status, "processing"),
        and(eq(clip.status, "ready"), lt(clip.encodeProgress, 100)),
      ),
      "encode lease status",
    ),
    requiredSql(
      or(
        isNull(clip.encodeLockedAt),
        lt(
          clip.encodeLockedAt,
          sql`now() - interval '${sql.raw(ENCODE_LEASE_STALE_INTERVAL)}'`,
        ),
      ),
      "encode lease freshness",
    ),
  ]
}

async function releaseEncodeLease(
  clipId: string,
  runId: string,
  reason: string,
): Promise<void> {
  await db
    .update(clip)
    .set({
      encodeRunId: null,
      encodeLockedAt: null,
      failureReason: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clip.id, clipId),
        eq(clip.encodeRunId, runId),
        ne(clip.status, "ready"),
      ),
    )
}

async function markFailedUnlessReady(
  clipId: string,
  reason: string,
): Promise<void> {
  try {
    const [owner] = await db
      .select({ authorId: clip.authorId, status: clip.status })
      .from(clip)
      .where(eq(clip.id, clipId))
      .limit(1)
    if (owner?.status === "ready") {
      await recordFailureReason(clipId, reason)
      return
    }
    await db
      .update(clip)
      .set({
        status: "failed",
        encodeRunId: null,
        encodeLockedAt: null,
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
    await cleanupTerminalScratchUploads(clipId)
    // Terminal transition — cheap path, one extra lookup for the
    // authorId is fine. Fire-and-forget; the write already landed.
    void publishClipUpsertById(clipId)
    if (owner) {
      void createNotification({
        recipientId: owner.authorId,
        type: "clip_upload_failed",
        clipId,
      })
    }
  } catch (err) {
    logger.error(`[queue] failed to mark clip ${clipId} as failed:`, err)
  }
}

async function cleanupTerminalScratchUploads(clipId: string): Promise<void> {
  const tickets = await db
    .select({
      id: clipUploadTicket.id,
      storageKey: clipUploadTicket.storageKey,
    })
    .from(clipUploadTicket)
    .where(eq(clipUploadTicket.clipId, clipId))
  await deleteScratchUploads(
    tickets.map((ticket) => ticket.storageKey),
    `terminal clip ${clipId} upload`,
  )
  await db.delete(clipUploadTicket).where(eq(clipUploadTicket.clipId, clipId))
}

async function recordFailureReason(
  clipId: string,
  reason: string,
): Promise<void> {
  try {
    await db
      .update(clip)
      .set({
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
  } catch (err) {
    logger.warn(`[queue] failed to record failure reason for ${clipId}:`, err)
  }
}
