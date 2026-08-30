import {
  storageDeletion,
  type StorageDeletionNamespace,
} from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, asc, eq, sql } from "drizzle-orm"

import { publishStorageDeletionWake } from "./deletion-events"
import {
  LIVE_REFERENCE_RECHECK_MS,
  storageDeletionRetryAt,
  type StorageDeletionInput,
  validateStorageDeletionInput,
  validateStorageKey,
} from "./deletion-policy"

export interface EnqueueStorageDeletionOptions {
  /**
   * Enqueue in the same transaction that removes the final live reference.
   * Transaction callers must invoke `wakeStorageDeletionWorker()` after the
   * transaction commits; startup and periodic reconciliation remain a backstop.
   */
  tx?: DbTransaction
  runAt?: Date
}

export async function enqueueStorageDeletion(
  input: StorageDeletionInput,
  options: EnqueueStorageDeletionOptions = {},
): Promise<string> {
  const validated = validateStorageDeletionInput(input)
  const executor = options.tx ?? db
  const now = new Date()
  const [row] = await executor
    .insert(storageDeletion)
    .values({
      namespace: validated.namespace,
      storage_key: validated.key,
      abort_upload: validated.abortUpload,
      reason: validated.reason,
      source_type: validated.sourceType,
      source_id: validated.sourceId,
      next_attempt_at: options.runAt ?? now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [storageDeletion.namespace, storageDeletion.storage_key],
      set: {
        // Two independent cleanup paths may discover the same object. Preserve
        // the stronger semantics and the earliest durable wake deadline.
        abort_upload: sql`${storageDeletion.abort_upload} or excluded.abort_upload`,
        reason: sql`excluded.reason`,
        source_type: sql`excluded.source_type`,
        source_id: sql`excluded.source_id`,
        next_attempt_at: sql`least(${storageDeletion.next_attempt_at}, excluded.next_attempt_at)`,
        revision: sql`${storageDeletion.revision} + 1`,
        updated_at: now,
      },
    })
    .returning({ id: storageDeletion.id })
  if (!row) throw new Error("Could not enqueue storage deletion")
  if (!options.tx) publishStorageDeletionWake()
  return row.id
}

export async function enqueueStorageDeletions(
  inputs: Iterable<StorageDeletionInput>,
  options: EnqueueStorageDeletionOptions = {},
): Promise<void> {
  for (const input of inputs) await enqueueStorageDeletion(input, options)
}

export async function cancelStorageDeletion(
  namespace: StorageDeletionNamespace,
  key: string,
  options: { tx?: DbTransaction } = {},
): Promise<boolean> {
  validateStorageKey(key)
  const executor = options.tx ?? db
  const rows = await executor
    .delete(storageDeletion)
    .where(
      and(
        eq(storageDeletion.namespace, namespace),
        eq(storageDeletion.storage_key, key),
      ),
    )
    .returning({ id: storageDeletion.id })
  return rows.length > 0
}

export async function probeStorageDeletionStore(): Promise<void> {
  await db.select({ id: storageDeletion.id }).from(storageDeletion).limit(1)
}

export async function selectNextStorageDeletion() {
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

export type PendingStorageDeletion = NonNullable<
  Awaited<ReturnType<typeof selectNextStorageDeletion>>
>

export async function completeStorageDeletion(
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

export async function deferReferencedStorageDeletion(
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

export function retryStorageDeletion(
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
