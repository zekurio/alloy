import { clip, clipRendition } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { clipScrubberKey } from "@alloy/server/clips/scrubber"
import { db } from "@alloy/server/db/index"
import {
  clipAssetDir,
  clipAssetKey,
  type StorageDriver,
} from "@alloy/server/storage/driver"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { inArray } from "drizzle-orm"

import type { JobHandlerContext } from "../registry"
import { writeStorageMaintenanceSummary } from "./storage-maintenance-summary"

const logger = createLogger("jobs")
const PAGE_SIZE = 500
// Comfortably above encode timeout ceilings and lease-retry cycles, so
// in-flight runs' freshly uploaded objects are never collected.
const ORPHAN_SAFETY_MARGIN_MS = 48 * 60 * 60 * 1000
const STORAGE_GC_SUMMARY_KEY = "storageGc"

interface StorageGcSummary {
  finishedAt: Date
  scanned: number
  deletedOrphanObjects: number
  deletedStaleAssets: number
}

interface ParsedStorageKey {
  clipId: string
  filename: string
}

interface GcEntry {
  key: string
  lastModified: Date | null
  storage: StorageDriver
}

interface GcClipRow {
  id: string
  sourceKey: string | null
  cutKey: string | null
  thumbKey: string | null
  encodeRunId: string | null
}

export async function runStorageOrphanGc(
  _payload: Record<string, never>,
  ctx: JobHandlerContext,
): Promise<void> {
  const summary: StorageGcSummary = {
    finishedAt: new Date(),
    scanned: 0,
    deletedOrphanObjects: 0,
    deletedStaleAssets: 0,
  }
  let page: GcEntry[] = []

  for await (const entry of listGcEntries()) {
    if (ctx.signal.aborted) break
    page.push(entry)
    if (page.length < PAGE_SIZE) continue
    await processGcPage(page, summary, ctx.signal)
    page = []
  }

  if (!ctx.signal.aborted && page.length > 0) {
    await processGcPage(page, summary, ctx.signal)
  }
  if (ctx.signal.aborted) return

  summary.finishedAt = new Date()
  await writeStorageMaintenanceSummary(STORAGE_GC_SUMMARY_KEY, summary)
  logger.info(
    `storage orphan gc complete: scanned=${summary.scanned} deletedOrphanObjects=${summary.deletedOrphanObjects} deletedStaleAssets=${summary.deletedStaleAssets}`,
  )
}

async function* listGcEntries(): AsyncIterable<GcEntry> {
  // Deliberately limited to parsed clip-owned asset keys. Copy fallback
  // `*.tmp` files and crashed `uploads/` completion debris can leak, but they
  // are not safely attributable to a committed clip yet and need a separate
  // policy before GC widens its deletion scope.
  for await (const entry of clipStorage.list("")) {
    yield { ...entry, storage: clipStorage }
  }
  for await (const entry of clipThumbnailStorage.list("")) {
    yield { ...entry, storage: clipThumbnailStorage }
  }
}

async function processGcPage(
  page: GcEntry[],
  summary: StorageGcSummary,
  signal: AbortSignal,
): Promise<void> {
  const parsed = page.map((entry) => ({
    entry,
    parsed: parseClipStorageKey(entry.key),
  }))
  const clipIds = [
    ...new Set(
      parsed
        .map((item) => item.parsed?.clipId)
        .filter((clipId): clipId is string => Boolean(clipId)),
    ),
  ]
  const rows = await selectGcClipRows(clipIds)
  const liveKeys = await selectLiveKeys(clipIds, rows)
  const cutoff = Date.now() - ORPHAN_SAFETY_MARGIN_MS

  for (const item of parsed) {
    if (signal.aborted) return
    summary.scanned += 1
    if (!item.parsed) continue
    if (!olderThan(item.entry.lastModified, cutoff)) continue
    const row = rows.get(item.parsed.clipId)
    if (!row) {
      await item.entry.storage.delete(item.entry.key)
      summary.deletedOrphanObjects += 1
      continue
    }
    // An active encode lease brackets publish-to-commit. During that window a
    // freshly published object may not be in the clip row yet, so stale-asset
    // deletion must wait for a later sweep.
    if (row.encodeRunId !== null) continue
    if (liveKeys.get(row.id)?.has(item.entry.key)) continue
    if (!isRunStampedFilename(item.parsed.filename)) continue
    await item.entry.storage.delete(item.entry.key)
    summary.deletedStaleAssets += 1
  }
}

async function selectGcClipRows(
  clipIds: string[],
): Promise<Map<string, GcClipRow>> {
  if (clipIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: clip.id,
      sourceKey: clip.source_key,
      cutKey: clip.cut_key,
      thumbKey: clip.thumb_key,
      encodeRunId: clip.encode_run_id,
    })
    .from(clip)
    .where(inArray(clip.id, clipIds))
  return new Map(rows.map((row) => [row.id, row]))
}

async function selectLiveKeys(
  clipIds: string[],
  rows: Map<string, GcClipRow>,
): Promise<Map<string, Set<string>>> {
  const liveKeys = new Map<string, Set<string>>()
  for (const row of rows.values()) {
    liveKeys.set(row.id, new Set(staticLiveKeys(row)))
  }
  if (clipIds.length === 0) return liveKeys

  const renditions = await db
    .select({
      clipId: clipRendition.clip_id,
      storageKey: clipRendition.storage_key,
    })
    .from(clipRendition)
    .where(inArray(clipRendition.clip_id, clipIds))
  for (const rendition of renditions) {
    liveKeys.get(rendition.clipId)?.add(rendition.storageKey)
  }
  return liveKeys
}

function staticLiveKeys(row: GcClipRow): string[] {
  return [
    row.sourceKey,
    row.cutKey,
    row.thumbKey,
    clipScrubberKey(row.id),
    clipAssetKey(row.id, "thumb"),
    clipAssetKey(row.id, "thumb-small"),
  ].filter((key): key is string => Boolean(key))
}

function parseClipStorageKey(key: string): ParsedStorageKey | null {
  const match =
    /^([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^/]+)$/i.exec(
      key,
    )
  if (!match) return null
  const clipId = match[3]
  if (!clipId) return null
  if (key.slice(0, key.lastIndexOf("/")) !== clipAssetDir(clipId)) return null
  return { clipId, filename: match[4] ?? "" }
}

function isRunStampedFilename(filename: string): boolean {
  return (
    /^source-[0-9a-f]{12}$/i.test(filename) ||
    /^cut-[0-9a-f]{12}\.mp4$/i.test(filename) ||
    /^rendition-.+-[0-9a-f]{12}\.mp4$/i.test(filename) ||
    /^thumb-[0-9a-f]{12}\.jpg$/i.test(filename)
  )
}

function olderThan(lastModified: Date | null, cutoff: number): boolean {
  return lastModified !== null && lastModified.getTime() < cutoff
}
