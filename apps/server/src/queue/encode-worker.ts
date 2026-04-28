import { eq } from "drizzle-orm"
import type { PgBoss } from "pg-boss"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipUpsertById } from "../clips/events"
import { configStore } from "../config/store"
import { createNotification } from "../notifications"
import { runEncodeInner } from "./encode-run"

export const ENCODE_JOB = "clip.encode" as const

const RETRY_LIMIT = 2

interface EncodeJobData {
  clipId: string
}

const activeEncodes = new Map<
  string,
  { abort: AbortController; done: Promise<void> }
>()
let registeredConcurrency: number | null = null
let reconfigurePromise: Promise<void> = Promise.resolve()

export async function cancelEncode(clipId: string): Promise<void> {
  const entry = activeEncodes.get(clipId)
  if (!entry) return
  entry.abort.abort()
  await entry.done
}

export async function registerEncodeWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(ENCODE_JOB, {
    policy: "standard",
    retryLimit: RETRY_LIMIT,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 60 * 60,
  })

  await configureEncodeWorker(boss, configStore.get("limits").queueConcurrency)

  configStore.subscribe((next, prev) => {
    if (next.limits.queueConcurrency === prev.limits.queueConcurrency) return
    const concurrency = next.limits.queueConcurrency
    reconfigurePromise = reconfigurePromise
      .catch(() => undefined)
      .then(() => configureEncodeWorker(boss, concurrency, { replace: true }))
  })
}

async function configureEncodeWorker(
  boss: PgBoss,
  concurrency: number,
  opts: { replace?: boolean } = {}
): Promise<void> {
  if (registeredConcurrency === concurrency && !opts.replace) return
  if (opts.replace) {
    await boss.offWork(ENCODE_JOB, { wait: true })
  }

  await boss.work<EncodeJobData>(
    ENCODE_JOB,
    {
      includeMetadata: true,
      localConcurrency: concurrency,
      batchSize: 1,
    },
    async (jobs) => {
      const job = jobs[0]
      if (!job) return
      const clipId = job.data.clipId
      try {
        await runEncode(clipId)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        const reason = err instanceof Error ? err.message : "Encode failed"
        if (job.retryCount >= RETRY_LIMIT) {
          await markFailedUnlessReady(clipId, reason)
        } else {
          await recordFailureReason(clipId, reason)
        }
        throw err
      }
    }
  )
  registeredConcurrency = concurrency
}

async function runEncode(clipId: string): Promise<void> {
  const [row] = await db.select().from(clip).where(eq(clip.id, clipId)).limit(1)
  if (!row) return
  if (
    row.status !== "uploaded" &&
    row.status !== "encoding" &&
    !(row.status === "ready" && row.encodeProgress < 100)
  )
    return

  const abort = new AbortController()
  let resolveDone: () => void = () => undefined
  const done = new Promise<void>((r) => {
    resolveDone = r
  })
  activeEncodes.set(clipId, { abort, done })

  try {
    await runEncodeInner(clipId, row, abort.signal)
  } finally {
    activeEncodes.delete(clipId)
    resolveDone()
  }
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
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
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
