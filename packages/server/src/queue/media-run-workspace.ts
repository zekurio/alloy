import { rm } from "node:fs/promises"

import { createLogger } from "@alloy/logging"
import { enqueueUnownedMediaAssets } from "@alloy/server/storage/media-deletion"

import { abortMediaProcessing } from "./media-abort"
import { makeMediaWorkDir } from "./media-run-helpers"
import type { MediaRow, MediaStore } from "./media-store"

const logger = createLogger("queue")

type MediaRunWorkspace = {
  workDir: string
  uploadedKeys: string[]
  retainedKeys: Set<string>
}

export async function withMediaRunWorkspace(
  options: {
    store: MediaStore
    id: string
    runId: string
    row: MediaRow
    cleanupLabel: string
  },
  run: (workspace: MediaRunWorkspace) => Promise<void>,
): Promise<void> {
  const workDir = await makeMediaWorkDir(options.id)
  const uploadedKeys: string[] = []
  const retainedKeys = new Set<string>()
  for (const key of [
    options.row.sourceKey,
    options.row.cutKey,
    options.row.thumbKey,
  ]) {
    if (key) retainedKeys.add(key)
  }

  try {
    await run({ workDir, uploadedKeys, retainedKeys })
  } catch (err) {
    await retainRowAssetKeys(options.store, options.id, retainedKeys)
    await enqueueUnownedMediaAssets({
      keys: new Set(uploadedKeys),
      retainedKeys,
      reason: "failed media processing asset",
      source: { type: "media-run", id: options.runId },
    })
    throw err
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((err) => {
      logger.warn(
        `failed to remove ${options.cleanupLabel} work dir ${workDir}:`,
        err,
      )
    })
  }
}

export async function ensureStillPresent(
  store: MediaStore,
  id: string,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if (await store.stillPresent(id, runId)) return
  throw abortMediaProcessing()
}

/**
 * A competing run may have published while this run was failing; never delete
 * whatever the row currently points at. If the read fails, uploaded keys are
 * still safe to enqueue because every generated key is scoped to this run.
 */
async function retainRowAssetKeys(
  store: MediaStore,
  id: string,
  retainedKeys: Set<string>,
): Promise<void> {
  try {
    const fresh = await store.currentAssetKeys(id)
    if (fresh?.sourceKey) retainedKeys.add(fresh.sourceKey)
    if (fresh?.cutKey) retainedKeys.add(fresh.cutKey)
    if (fresh?.thumbKey) retainedKeys.add(fresh.thumbKey)
    for (const key of fresh?.renditionKeys ?? []) retainedKeys.add(key)
    for (const key of fresh?.audioTrackKeys ?? []) retainedKeys.add(key)
  } catch (err) {
    logger.warn(`failed to retain row asset keys for ${id}:`, err)
  }
}
