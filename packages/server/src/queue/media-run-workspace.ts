import { rm } from "node:fs/promises"

import { createLogger } from "@alloy/logging"
import { clipStorageForKey } from "@alloy/server/storage/index"

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
    row: MediaRow
    cleanupLabel: string
    onFailure?: () => Promise<void>
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
    await deleteAssetsBestEffort(
      new Set(uploadedKeys),
      retainedKeys,
      "failed media processing asset",
    )
    if (options.onFailure) await options.onFailure()
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

export async function pruneStaleAssets(
  row: Pick<MediaRow, "sourceKey" | "cutKey" | "thumbKey">,
  previousRenditionKeys: readonly string[],
  retainedKeys: Iterable<string>,
): Promise<void> {
  const retained = new Set(retainedKeys)
  const previousKeys = new Set([
    row.sourceKey,
    row.cutKey,
    row.thumbKey,
    ...previousRenditionKeys,
  ])
  previousKeys.delete(null)

  await deleteAssetsBestEffort(
    [...previousKeys].filter((key): key is string => key !== null),
    retained,
    "stale recording asset",
  )
}

/**
 * A competing run may have published while this run was failing; never delete
 * whatever the row currently points at. Best-effort: if the read fails,
 * uploadedKeys are run-scoped, so deleting them is safe regardless.
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
  } catch (err) {
    logger.warn(`failed to retain row asset keys for ${id}:`, err)
  }
}

async function deleteAssetsBestEffort(
  keys: Iterable<string>,
  retainedKeys: ReadonlySet<string>,
  label: string,
): Promise<void> {
  await Promise.all(
    [...keys]
      .filter((key) => !retainedKeys.has(key))
      .map(async (key) => {
        try {
          await clipStorageForKey(key).delete(key)
        } catch (err) {
          logger.warn(`failed to delete ${label} ${key}:`, err)
        }
      }),
  )
}
