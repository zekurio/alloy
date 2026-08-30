import type { StorageDeletionNamespace } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { errorMessage } from "@alloy/server/runtime/error-message"
import { WakeableSerialWorker } from "@alloy/server/runtime/wakeable-serial-worker"

import { subscribeStorageDeletionWake } from "./deletion-events"
import { storageDeletionHasLiveReference } from "./deletion-references"
import { runStorageDeletion } from "./deletion-run"
import {
  completeStorageDeletion,
  deferReferencedStorageDeletion,
  probeStorageDeletionStore,
  retryStorageDeletion,
  selectNextStorageDeletion,
} from "./deletion-store"
import type { StorageDriver } from "./driver"
import { assetStorage, clipStorage, clipThumbnailStorage } from "./index"

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
let unsubscribeWake: (() => void) | null = null

/**
 * Verify the durable store before the HTTP listener opens, then start the
 * adaptive single-process coordinator. Its immediate first pass recovers all
 * due work after a restart.
 */
export async function startStorageDeletionWorker(): Promise<void> {
  if (started) return
  const unsubscribe = subscribeStorageDeletionWake(() => worker.wake())
  try {
    await probeStorageDeletionStore()
    worker.start()
    unsubscribeWake = unsubscribe
    started = true
  } catch (cause) {
    unsubscribe()
    throw cause
  }
}

export function wakeStorageDeletionWorker(): void {
  worker.wake()
}

export async function stopStorageDeletionWorker(): Promise<void> {
  if (!started) return
  started = false
  unsubscribeWake?.()
  unsubscribeWake = null
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
    const result = await runStorageDeletion(row, {
      storage: storageDriver(row.namespace),
      hasLiveReference: storageDeletionHasLiveReference,
      signal,
    })
    if (result === "interrupted") {
      return { worked: false as const, nextRunAt: row.nextAttemptAt }
    }
    if (result === "referenced") {
      await deferReferencedStorageDeletion(row, attemptedAt)
      return { worked: true as const }
    }
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

function storageDriver(namespace: StorageDeletionNamespace): StorageDriver {
  switch (namespace) {
    case "clips":
      return clipStorage
    case "thumbnails":
      return clipThumbnailStorage
    case "assets":
      return assetStorage
  }
}
