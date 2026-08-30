import { db } from "@alloy/server/db/index"

import { mediaAssetDeletionIntents } from "./deletion-producers"
import { enqueueStorageDeletion } from "./deletion-store"
import { wakeStorageDeletionWorker } from "./deletion-worker"

/** Durably claim immutable media objects that were never attached to a row. */
export async function enqueueUnownedMediaAssets(input: {
  keys: Iterable<string | null>
  retainedKeys?: Iterable<string | null>
  reason: string
  source: { type: string; id?: string | null }
}): Promise<number> {
  const intents = mediaAssetDeletionIntents(input)
  if (intents.length === 0) return 0

  await db.transaction(async (tx) => {
    for (const intent of intents) {
      await enqueueStorageDeletion(intent, { tx })
    }
  })
  wakeStorageDeletionWorker()
  return intents.length
}
