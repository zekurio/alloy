import { and, eq, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm"

import { clip, clipUploadTicket } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipUpsertById } from "../clips/events"
import { configStore } from "../config/store"
import { createNotification } from "../notifications"
import { deleteScratchUpload } from "../uploads/scratch"
import { runEncodeInner } from "./encode-run"

export const ENCODE_JOB = "clip.encode" as const

const RETRY_LIMIT = 2
const ENCODE_LEASE_STALE_INTERVAL = "2 hours"
const RETRY_DELAY_INTERVAL = "30 seconds"
const POLL_INTERVAL_MS = 5000

const activeEncodes = new Map<
  string,
  { abort: AbortController; done: Promise<void> }
>()
const queuedClipIds = new Set<string>()
const inFlightClipIds = new Set<string>()
const runningJobs = new Set<Promise<void>>()
let wakeTimer: NodeJS.Timeout | null = null
let pumpPromise: Promise<void> | null = null
let unsubscribeConfig: (() => void) | null = null
let started = false
let stopping = false

export async function cancelEncode(clipId: string): Promise<void> {
  const entry = activeEncodes.get(clipId)
  if (!entry) return
  entry.abort.abort()
  await entry.done
}

export function enqueueEncode(clipId: string): void {
  queuedClipIds.add(clipId)
  schedulePump(0)
}

export async function startEncodeWorker(): Promise<void> {
  if (started) return
  started = true
  stopping = false
  unsubscribeConfig = configStore.subscribe((next, prev) => {
    if (next.limits.queueConcurrency === prev.limits.queueConcurrency) return
    schedulePump(0)
  })
  schedulePump(0)
}

export async function stopEncodeWorker(): Promise<void> {
  if (!started) return
  started = false
  stopping = true
  if (wakeTimer) {
    clearTimeout(wakeTimer)
    wakeTimer = null
  }
  unsubscribeConfig?.()
  unsubscribeConfig = null
  for (const entry of activeEncodes.values()) {
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
      // eslint-disable-next-line no-console
      console.error("[queue] encode worker pump failed:", err)
      schedulePump(POLL_INTERVAL_MS)
    })
    .finally(() => {
      pumpPromise = null
    })
  return pumpPromise
}

async function pumpInner(): Promise<void> {
  while (
    started &&
    !stopping &&
    runningJobs.size < configStore.get("limits").queueConcurrency
  ) {
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
            sql`now() - interval '${sql.raw(RETRY_DELAY_INTERVAL)}'`
          )
        )
      )
    )
    .orderBy(clip.updatedAt)
    .limit(configStore.get("limits").queueConcurrency + inFlightClipIds.size)

  return rows.find((row) => !inFlightClipIds.has(row.id))?.id ?? null
}

async function processClip(clipId: string): Promise<void> {
  inFlightClipIds.add(clipId)
  try {
    await runEncode(clipId)
  } catch (err) {
    if ((err as Error).name === "AbortError") return
    // eslint-disable-next-line no-console
    console.error(`[queue] encode job failed for ${clipId}:`, err)
  } finally {
    inFlightClipIds.delete(clipId)
  }
}

async function runEncode(clipId: string): Promise<void> {
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
  activeEncodes.set(clipId, { abort, done })

  try {
    await runEncodeInner(clipId, row, runId, abort.signal)
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      if (stopping) {
        await releaseEncodeLease(
          clipId,
          runId,
          "Encode interrupted by shutdown"
        )
      }
    } else {
      const reason = err instanceof Error ? err.message : "Encode failed"
      if (row.encodeAttempt > RETRY_LIMIT) {
        await markFailedUnlessReady(clipId, reason)
      } else {
        await releaseEncodeLease(clipId, runId, reason)
      }
    }
    throw err
  } finally {
    activeEncodes.delete(clipId)
    resolveDone()
  }
}

function encodeLeaseConditions(): [SQL, SQL] {
  return [
    or(
      eq(clip.status, "processing"),
      and(eq(clip.status, "ready"), lt(clip.encodeProgress, 100))
    )!,
    or(
      isNull(clip.encodeLockedAt),
      lt(
        clip.encodeLockedAt,
        sql`now() - interval '${sql.raw(ENCODE_LEASE_STALE_INTERVAL)}'`
      )
    )!,
  ]
}

async function releaseEncodeLease(
  clipId: string,
  runId: string,
  reason: string
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
        ne(clip.status, "ready")
      )
    )
}

async function markFailedUnlessReady(
  clipId: string,
  reason: string
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
    // eslint-disable-next-line no-console
    console.error(`[queue] failed to mark clip ${clipId} as failed:`, err)
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
  await Promise.allSettled(
    tickets.map((ticket) => deleteScratchUpload(ticket.storageKey))
  )
  await db.delete(clipUploadTicket).where(eq(clipUploadTicket.clipId, clipId))
}

async function recordFailureReason(
  clipId: string,
  reason: string
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
    // eslint-disable-next-line no-console
    console.warn(`[queue] failed to record failure reason for ${clipId}:`, err)
  }
}
