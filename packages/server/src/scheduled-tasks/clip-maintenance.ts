import { mkdir, mkdtemp, opendir, readdir, rmdir, rm } from "node:fs/promises"

import { clip } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { and, eq, inArray } from "drizzle-orm"

import { publishClipUpsert } from "../clips/events"
import {
  OPEN_GRAPH_CONTENT_TYPE,
  publishOpenGraphVariant,
  statOpenGraphVariant,
} from "../clips/opengraph-variant"
import { db } from "../db"
import { probe } from "../queue/ffmpeg"
import { ENCODE_DIR, CLIPS_DIR } from "../runtime/dirs"
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

type ClipRow = typeof clip.$inferSelect

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

export const clipOpenGraphMaintenanceTask: ScheduledTask = {
  id: "clip-opengraph-maintenance",
  name: "Clip OpenGraph maintenance",
  description: "Ensures ready clips have stored OpenGraph variants.",
  triggers: CLIP_MAINTENANCE_TRIGGERS,
  run: async ({ signal }): Promise<ScheduledTaskResult> => {
    const opengraph = await ensureOpenGraphVariants(signal)
    return {
      readyClipsScanned: opengraph.readyClipsScanned,
      openGraphVariantsCreated: opengraph.openGraphVariantsCreated,
      openGraphVariantMetadataFixed: opengraph.openGraphVariantMetadataFixed,
      openGraphVariantFailures: opengraph.openGraphVariantFailures,
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

async function ensureOpenGraphVariants(signal: AbortSignal): Promise<{
  readyClipsScanned: number
  openGraphVariantsCreated: number
  openGraphVariantMetadataFixed: number
  openGraphVariantFailures: number
}> {
  const rows = await db
    .select()
    .from(clip)
    .where(eq(clip.status, "ready"))
    .orderBy(clip.createdAt)

  let openGraphVariantsCreated = 0
  let openGraphVariantMetadataFixed = 0
  let openGraphVariantFailures = 0

  for (const row of rows) {
    throwIfAborted(signal)
    if (!row.sourceKey) continue

    const current = await statOpenGraphVariant(row.openGraphKey)
    if (
      row.openGraphContentType === OPEN_GRAPH_CONTENT_TYPE &&
      current.exists
    ) {
      if (current.sizeBytes !== row.openGraphSizeBytes) {
        await db
          .update(clip)
          .set({
            openGraphSizeBytes: current.sizeBytes,
            updatedAt: new Date(),
          })
          .where(eq(clip.id, row.id))
        openGraphVariantMetadataFixed += 1
      }
      continue
    }

    try {
      if (await regenerateOpenGraphVariant(row, signal)) {
        openGraphVariantsCreated += 1
      }
    } catch (err) {
      if (signal.aborted) throw err
      openGraphVariantFailures += 1
      logger.warn(
        `[scheduled-tasks] failed to ensure OpenGraph variant for ${row.id}:`,
        err,
      )
    }
  }

  return {
    readyClipsScanned: rows.length,
    openGraphVariantsCreated,
    openGraphVariantMetadataFixed,
    openGraphVariantFailures,
  }
}

async function regenerateOpenGraphVariant(
  row: ClipRow,
  signal: AbortSignal,
): Promise<boolean> {
  if (!row.sourceKey) return false

  await mkdir(ENCODE_DIR, { recursive: true })
  const scratchDir = await mkdtemp(`${ENCODE_DIR}/${row.id}-og-task-`)
  const sourcePath = join(scratchDir, "source")
  const outPath = join(scratchDir, "opengraph.mp4")

  try {
    await clipStorage.downloadToFile(row.sourceKey, sourcePath)
    throwIfAborted(signal)

    const probed = await probe(sourcePath)
    const asset = await publishOpenGraphVariant({
      clipId: row.id,
      sourcePath,
      outPath,
      source: probed,
      signal,
      onProgress: () => undefined,
    })
    throwIfAborted(signal)

    const [updated] = await db
      .update(clip)
      .set({
        openGraphKey: asset.storageKey,
        openGraphContentType: asset.contentType,
        openGraphSizeBytes: asset.sizeBytes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clip.id, row.id),
          eq(clip.status, "ready"),
          eq(clip.sourceKey, row.sourceKey),
        ),
      )
      .returning({ id: clip.id })
    if (!updated) return false

    if (row.openGraphKey && row.openGraphKey !== asset.storageKey) {
      await clipStorage.delete(row.openGraphKey).catch((err) => {
        logger.warn(
          `[scheduled-tasks] failed to delete stale OpenGraph asset ${row.openGraphKey}:`,
          err,
        )
      })
    }
    void publishClipUpsert(row.authorId, row.id)
    return true
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch((err) => {
      logger.warn(
        `[scheduled-tasks] failed to remove OpenGraph scratch ${scratchDir}:`,
        err,
      )
    })
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

async function selectClipRowsById(
  ids: string[],
): Promise<Map<string, ClipRow>> {
  const rowsById = new Map<string, ClipRow>()
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

function retainedClipAssetKeys(row: ClipRow): Set<string> {
  return new Set(
    [
      row.sourceKey,
      row.openGraphKey,
      row.thumbKey,
      ...row.variants.map((variant) => variant.storageKey),
    ].filter((key): key is string => Boolean(key)),
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
