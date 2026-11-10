import {
  storageDeletion,
  type StorageDeletionNamespace,
} from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, eq, sql } from "drizzle-orm"

import {
  type StorageDeletionInput,
  validateStorageDeletionInput,
  validateStorageKey,
} from "./deletion-policy"
import { wakeStorageDeletionWorker } from "./deletion-worker"

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
  if (!options.tx) wakeStorageDeletionWorker()
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
): Promise<void> {
  validateStorageKey(key)
  const executor = options.tx ?? db
  await executor
    .delete(storageDeletion)
    .where(
      and(
        eq(storageDeletion.namespace, namespace),
        eq(storageDeletion.storage_key, key),
      ),
    )
}
