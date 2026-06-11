import { opendir, readdir, rmdir, rm } from "node:fs/promises"

import { type Clip, clip } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { inArray } from "drizzle-orm"

import { db } from "../db"
import { CLIPS_DIR } from "../runtime/dirs"
import { dirname, join } from "../runtime/path"
import { clipAssetDir, clipStorage } from "../storage"
import { startupAndCronTriggers } from "./triggers"
import type { ScheduledTask, ScheduledTaskResult } from "./types"

const CLIP_MAINTENANCE_TRIGGERS = startupAndCronTriggers({
  startupDelayMs: 60 * 1000,
  cronExpression: "0 */6 * * *",
})
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_PAIR_RE = /^[0-9a-f]{2}$/i
const DB_BATCH_SIZE = 500

type ClipFolder = {
  clipId: string
  key: string
  path: string
}

export const clipStorageCleanupTask: ScheduledTask = {
  id: "clip-storage-cleanup",
  name: "Clip storage cleanup",
  description: "Deletes orphaned clip folders and unreferenced clip assets.",
  triggers: CLIP_MAINTENANCE_TRIGGERS,
  run: async ({ signal }): Promise<ScheduledTaskResult> => {
    const cleanup = await cleanupClipFolders(signal)
    return {
      clipFoldersScanned: cleanup.clipFoldersScanned,
      orphanClipFoldersDeleted: cleanup.orphanClipFoldersDeleted,
      orphanAssetsDeleted: cleanup.orphanAssetsDeleted,
    }
  },
}

async function cleanupClipFolders(signal: AbortSignal): Promise<{
  clipFoldersScanned: number
  orphanClipFoldersDeleted: number
  orphanAssetsDeleted: number
}> {
  const folders = await listClipFolders(signal)
  const rowsById = await selectClipRowsById(
    folders.map((folder) => folder.clipId),
  )
  let orphanClipFoldersDeleted = 0
  let orphanAssetsDeleted = 0

  for (const folder of folders) {
    throwIfAborted(signal)
    const row = rowsById.get(folder.clipId)
    if (!row) {
      await rm(folder.path, { recursive: true, force: true })
      await pruneEmptyAncestors(dirname(folder.path))
      orphanClipFoldersDeleted += 1
      continue
    }

    const retainedKeys = retainedClipAssetKeys(row)
    const storedKeys = await listStoredAssetKeys(folder)
    for (const key of storedKeys) {
      throwIfAborted(signal)
      if (retainedKeys.has(key)) continue
      try {
        await clipStorage.delete(key)
        orphanAssetsDeleted += 1
      } catch (err) {
        logger.warn(
          `[scheduled-tasks] failed to delete orphan asset ${key}:`,
          err,
        )
      }
    }
  }

  return {
    clipFoldersScanned: folders.length,
    orphanClipFoldersDeleted,
    orphanAssetsDeleted,
  }
}

async function listClipFolders(signal: AbortSignal): Promise<ClipFolder[]> {
  const root = await openDirectoryOrNull(CLIPS_DIR)
  if (!root) return []

  const folders: ClipFolder[] = []
  for await (const aa of root) {
    throwIfAborted(signal)
    if (!aa.isDirectory() || !HEX_PAIR_RE.test(aa.name)) continue
    const aaPath = join(CLIPS_DIR, aa.name)
    const bbRoot = await openDirectoryOrNull(aaPath)
    if (!bbRoot) continue
    for await (const bb of bbRoot) {
      throwIfAborted(signal)
      if (!bb.isDirectory() || !HEX_PAIR_RE.test(bb.name)) continue
      const bbPath = join(aaPath, bb.name)
      const clipRoot = await openDirectoryOrNull(bbPath)
      if (!clipRoot) continue
      for await (const clipDir of clipRoot) {
        throwIfAborted(signal)
        if (!clipDir.isDirectory() || !UUID_RE.test(clipDir.name)) continue
        const key = clipAssetDir(clipDir.name)
        folders.push({
          clipId: clipDir.name,
          key,
          path: join(CLIPS_DIR, key),
        })
      }
    }
  }
  return folders
}

async function selectClipRowsById(ids: string[]): Promise<Map<string, Clip>> {
  const rowsById = new Map<string, Clip>()
  for (let i = 0; i < ids.length; i += DB_BATCH_SIZE) {
    const batch = ids.slice(i, i + DB_BATCH_SIZE)
    if (batch.length === 0) continue
    const rows = await db.select().from(clip).where(inArray(clip.id, batch))
    for (const row of rows) rowsById.set(row.id, row)
  }
  return rowsById
}

async function listStoredAssetKeys(folder: ClipFolder): Promise<string[]> {
  return listStoredAssetKeysInner(folder.path, folder.key)
}

async function listStoredAssetKeysInner(
  dirPath: string,
  dirKey: string,
): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(
    (err: unknown) => {
      if (isNodeErrorCode(err, "ENOENT")) return []
      throw err
    },
  )
  const keys: string[] = []
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name)
    const entryKey = `${dirKey}/${entry.name}`
    if (entry.isDirectory()) {
      keys.push(...(await listStoredAssetKeysInner(entryPath, entryKey)))
    } else if (entry.isFile()) {
      keys.push(entryKey)
    }
  }
  return keys
}

function retainedClipAssetKeys(row: Clip): Set<string> {
  return new Set(
    [row.sourceKey, row.thumbKey].filter((key): key is string => Boolean(key)),
  )
}

async function openDirectoryOrNull(path: string) {
  return await opendir(path).catch((err: unknown) => {
    if (isNodeErrorCode(err, "ENOENT")) return null
    throw err
  })
}

async function pruneEmptyAncestors(startDir: string): Promise<void> {
  let current = startDir
  while (current !== CLIPS_DIR && current.startsWith(`${CLIPS_DIR}/`)) {
    try {
      await rmdir(current)
    } catch (err) {
      if (
        isNodeErrorCode(err, "ENOENT") ||
        isNodeErrorCode(err, "ENOTEMPTY") ||
        isNodeErrorCode(err, "EEXIST")
      ) {
        return
      }
      throw err
    }
    current = dirname(current)
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Scheduled task cancelled", "AbortError")
  }
}

function isNodeErrorCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code
}
