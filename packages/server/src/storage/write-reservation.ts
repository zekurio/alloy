import type { StorageDeletionNamespace } from "@alloy/db/schema"
import type { DbTransaction } from "@alloy/server/db/transaction"

import { prewriteDeletionIntent } from "./deletion-producers"
import {
  cancelStorageDeletion,
  enqueueStorageDeletions,
} from "./deletion-store"
import { withStorageObjectWriteActivity } from "./write-activity"

/** Long enough for a write and the transaction that attaches it. */
const RESERVATION_DELAY_MS = 60 * 1000

export interface StorageWrite {
  namespace: StorageDeletionNamespace
  key: string
}

/**
 * Durably reserves objects before any of their bytes are written: a delayed
 * deletion intent per object. An object a row comes to point at is kept,
 * since the deletion worker adopts its reservation; one left behind because
 * the write failed or the process died is deleted once the delay has passed
 * and no media run holds its clip.
 */
export async function reserveStorageWrites(
  writes: readonly StorageWrite[],
  attemptId: string,
): Promise<void> {
  await enqueueStorageDeletions(
    writes.map((write) => prewriteDeletionIntent({ ...write, attemptId })),
    { runAt: new Date(Date.now() + RESERVATION_DELAY_MS) },
  )
}

/**
 * Reserves objects for an operation that writes them and then attaches them
 * in one transaction, which cancels their reservations through
 * `adoptStorageWrites`. The objects are fenced for the whole operation, so
 * the deletion worker never takes one between its write and that
 * transaction.
 */
export function withReservedStorageWrites<T>(
  writes: readonly StorageWrite[],
  attemptId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const reserved = async () => {
    await reserveStorageWrites(writes, attemptId)
    return operation()
  }
  return writes.reduceRight<() => Promise<T>>(
    (inner, write) => () =>
      withStorageObjectWriteActivity(write.namespace, write.key, inner),
    reserved,
  )()
}

/** Cancels the reservations of objects the transaction attaches to a row. */
export async function adoptStorageWrites(
  writes: readonly StorageWrite[],
  tx: DbTransaction,
): Promise<void> {
  for (const write of writes) {
    await cancelStorageDeletion(write.namespace, write.key, { tx })
  }
}
