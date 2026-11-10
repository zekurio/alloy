import { storageDeletion } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { errorMessage } from "@alloy/server/runtime/error-message"
import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"
import { and, asc, eq, sql } from "drizzle-orm"

import {
  LIVE_REFERENCE_RECHECK_MS,
  storageDeletionRetryAt,
} from "./deletion-policy"
import { runStorageDeletion } from "./deletion-run"

const logger = createLogger("storage-deletion")
const RECONCILIATION_INTERVAL_MS = 60_000

const worker = new WakeableSerialWorker({
  reconciliationIntervalMs: RECONCILIATION_INTERVAL_MS,
  errorRetryMs: 5_000,
  runOne: deleteNextPendingObject,
  onError: (cause) =>
    logger.error("storage deletion coordinator failed:", cause),
})

let started = false

/**
 * Verify the durable store before the HTTP listener opens, then start the
 * adaptive single-process coordinator. Its immediate first pass recovers all
 * due work after a restart.
 */
export async function startStorageDeletionWorker(): Promise<void> {
  if (started) return
  await db.select({ id: storageDeletion.id }).from(storageDeletion).limit(1)
  worker.start()
  started = true
}

export function wakeStorageDeletionWorker(): void {
  worker.wake()
}

export async function stopStorageDeletionWorker(): Promise<void> {
  if (!started) return
  started = false
  await worker.stop()
}

async function deleteNextPendingObject(signal: AbortSignal) {
  const row = await selectNextStorageDeletion()
  if (!row) return { worked: false as const, nextRunAt: null }
  if (row.nextAttemptAt.getTime() > Date.now()) {
    return { worked: false as const, nextRunAt: row.nextAttemptAt }
  }

  const attemptedAt = new Date()
  try {
    const result = await runStorageDeletion(row, signal)
    if (result === "interrupted") {
      return { worked: false as const, nextRunAt: row.nextAttemptAt }
    }
    if (result === "referenced") {
      await deferReferencedStorageDeletion(row, attemptedAt)
      return { worked: true as const }
    }
    // A prewrite reservation whose object is now authoritatively referenced
    // has fulfilled its purpose. Completing it prevents a successful, but
    // commit-uncertain, upload from being deferred forever.
    await completeStorageDeletion(row)
    return { worked: true as const }
  } catch (cause) {
    if (signal.aborted) {
      return { worked: false as const, nextRunAt: row.nextAttemptAt }
    }
    const detail = errorMessage(cause, "Storage deletion failed")
    const recorded = await retryStorageDeletion(row, detail, attemptedAt)
    if (recorded) {
      logger.warn(
        `could not delete ${row.namespace}:${row.key}; retry remains durable: ${detail}`,
      )
    }
    return { worked: true as const }
  }
}

async function selectNextStorageDeletion() {
  const [row] = await db
    .select({
      id: storageDeletion.id,
      namespace: storageDeletion.namespace,
      key: storageDeletion.storage_key,
      abortUpload: storageDeletion.abort_upload,
      reason: storageDeletion.reason,
      sourceType: storageDeletion.source_type,
      sourceId: storageDeletion.source_id,
      nextAttemptAt: storageDeletion.next_attempt_at,
      attempts: storageDeletion.attempts,
      revision: storageDeletion.revision,
    })
    .from(storageDeletion)
    .orderBy(
      asc(storageDeletion.next_attempt_at),
      asc(storageDeletion.created_at),
    )
    .limit(1)
  return row ?? null
}

type PendingStorageDeletion = NonNullable<
  Awaited<ReturnType<typeof selectNextStorageDeletion>>
>

async function completeStorageDeletion(
  row: Pick<PendingStorageDeletion, "id" | "revision">,
): Promise<void> {
  await db
    .delete(storageDeletion)
    .where(
      and(
        eq(storageDeletion.id, row.id),
        eq(storageDeletion.revision, row.revision),
      ),
    )
}

async function deferReferencedStorageDeletion(
  row: Pick<PendingStorageDeletion, "id" | "revision">,
  checkedAt: Date,
): Promise<void> {
  await db
    .update(storageDeletion)
    .set({
      next_attempt_at: new Date(
        checkedAt.getTime() + LIVE_REFERENCE_RECHECK_MS,
      ),
      updated_at: checkedAt,
    })
    .where(
      and(
        eq(storageDeletion.id, row.id),
        eq(storageDeletion.revision, row.revision),
      ),
    )
}

function retryStorageDeletion(
  row: Pick<PendingStorageDeletion, "id" | "revision" | "attempts">,
  error: string,
  attemptedAt: Date,
): Promise<boolean> {
  return recordStorageDeletionFailure(
    row,
    error,
    storageDeletionRetryAt(row.attempts, attemptedAt),
    attemptedAt,
  )
}

async function recordStorageDeletionFailure(
  row: Pick<PendingStorageDeletion, "id" | "revision">,
  error: string,
  nextAttemptAt: Date,
  attemptedAt: Date,
): Promise<boolean> {
  const updated = await db
    .update(storageDeletion)
    .set({
      attempts: sql`${storageDeletion.attempts} + 1`,
      last_error: error,
      next_attempt_at: nextAttemptAt,
      updated_at: attemptedAt,
    })
    .where(
      and(
        eq(storageDeletion.id, row.id),
        eq(storageDeletion.revision, row.revision),
      ),
    )
    .returning({ id: storageDeletion.id })
  return updated.length > 0
}
