import { clip, clipRendition } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { encodeFingerprint } from "@alloy/server/media/encode-fingerprint"
import { clipStorageForKey } from "@alloy/server/storage/index"
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import { EmptyPayloadSchema } from "../payloads"
import { defineJobKind, type JobHandlerContext } from "../registry"
import { enqueue, type EnqueueOptions } from "../store"
import { enqueueClipEncode } from "./clip-encode"
import { writeStorageMaintenanceSummary } from "./storage-maintenance-summary"
import { runStorageOrphanGc } from "./storage-orphan-gc"

const logger = createLogger("jobs")

const CLIP_VERIFY_ASSETS_KIND = "clip.verify-assets"
const CLIP_VERIFY_KIND = "clip.verify"
const STORAGE_ORPHAN_GC_KIND = "storage.orphan-gc"
const PAGE_SIZE = 500
const STORAGE_VERIFY_SUMMARY_KEY = "storageVerify"
const SOURCE_MISSING_REASON = "source bytes missing from storage"

const ClipVerifyPayloadSchema = z.object({ clipId: z.uuid() })

export interface VerifyClipAssetsSummary {
  checked: number
  missingRenditions: number
  missingCuts: number
  missingThumbs: number
  missingSources: number
  repaired: number
}

interface VerifyClipRow {
  id: string
  sourceKey: string | null
  cutKey: string | null
  thumbKey: string | null
  encodeFingerprint: string | null
  height: number | null
  sourceFps: number | null
  sourceContentType: string | null
  sourceCodecs: string | null
  trimStartMs: number | null
  trimEndMs: number | null
}

interface VerifyRenditionRow {
  id: string
  storageKey: string
}

interface StorageVerifySummary extends VerifyClipAssetsSummary {
  finishedAt: Date
}

defineJobKind({
  kind: CLIP_VERIFY_ASSETS_KIND,
  queue: "io",
  schema: EmptyPayloadSchema,
  defaultPriority: 70,
  retry: { maxAttempts: 1, backoffMs: 60_000 },
  handler: runStorageVerify,
})

defineJobKind({
  kind: CLIP_VERIFY_KIND,
  queue: "io",
  schema: ClipVerifyPayloadSchema,
  defaultPriority: 40,
  retry: { maxAttempts: 1, backoffMs: 60_000 },
  handler: async (payload) => {
    await verifyClipAssets(payload.clipId)
  },
})

defineJobKind({
  kind: STORAGE_ORPHAN_GC_KIND,
  queue: "io",
  schema: EmptyPayloadSchema,
  defaultPriority: 80,
  retry: { maxAttempts: 1, backoffMs: 60_000 },
  handler: runStorageOrphanGc,
})

export function enqueueStorageVerify(
  options: Pick<EnqueueOptions, "runAt"> = {},
): Promise<string> {
  return enqueue(
    CLIP_VERIFY_ASSETS_KIND,
    {},
    {
      dedupKey: CLIP_VERIFY_ASSETS_KIND,
      priority: 70,
      runAt: options.runAt,
    },
  )
}

export function enqueueClipVerify(
  clipId: string,
  options: Pick<EnqueueOptions, "runAt"> = {},
): Promise<string> {
  return enqueue(
    CLIP_VERIFY_KIND,
    { clipId },
    { dedupKey: clipId, priority: 40, runAt: options.runAt },
  )
}

export function enqueueStorageOrphanGc(
  options: Pick<EnqueueOptions, "runAt"> = {},
): Promise<string> {
  return enqueue(
    STORAGE_ORPHAN_GC_KIND,
    {},
    {
      dedupKey: STORAGE_ORPHAN_GC_KIND,
      priority: 80,
      runAt: options.runAt,
    },
  )
}

export async function verifyClipAssets(
  clipId: string,
): Promise<VerifyClipAssetsSummary> {
  const row = await selectVerifyClip(clipId)
  if (!row) return emptyVerifySummary()
  const renditions = await selectVerifyRenditions(clipId)
  const summary = emptyVerifySummary()

  const sourceMissing = row.sourceKey
    ? !(await objectExists(row.sourceKey, summary))
    : false
  const missingRenditions: VerifyRenditionRow[] = []
  const resolvedRenditions: VerifyRenditionRow[] = []
  for (const rendition of renditions) {
    if (await objectExists(rendition.storageKey, summary)) {
      resolvedRenditions.push(rendition)
      continue
    }
    missingRenditions.push(rendition)
  }

  const cutMissing = row.cutKey
    ? !(await objectExists(row.cutKey, summary))
    : false
  const cutResolves = Boolean(row.cutKey && !cutMissing)
  const thumbMissing = row.thumbKey
    ? !(await objectExists(row.thumbKey, summary))
    : false

  summary.missingSources = sourceMissing ? 1 : 0
  summary.missingRenditions = missingRenditions.length
  summary.missingCuts = cutMissing ? 1 : 0
  summary.missingThumbs = thumbMissing ? 1 : 0

  if (sourceMissing) {
    summary.repaired = (await quarantineMissingSource({
      row,
      failed: resolvedRenditions.length === 0 && !cutResolves,
    }))
      ? 1
      : 0
    return summary
  }

  if (missingRenditions.length === 0 && !cutMissing && !thumbMissing) {
    return summary
  }

  summary.repaired = (await repairMissingDerivedAssets({
    row,
    missingRenditions,
    cutMissing,
    thumbMissing,
  }))
    ? 1
    : 0
  return summary
}

async function runStorageVerify(
  _payload: z.infer<typeof EmptyPayloadSchema>,
  ctx: JobHandlerContext,
): Promise<void> {
  const summary: StorageVerifySummary = {
    ...emptyVerifySummary(),
    finishedAt: new Date(),
  }
  let cursor: string | null = null

  for (;;) {
    if (ctx.signal.aborted) break
    const page = await selectVerifyPage(cursor)
    if (page.length === 0) break
    cursor = page[page.length - 1]?.id ?? cursor

    for (const row of page) {
      if (ctx.signal.aborted) break
      addVerifySummary(summary, await verifyClipAssets(row.id))
    }
  }

  if (ctx.signal.aborted) return

  summary.finishedAt = new Date()
  await writeStorageMaintenanceSummary(STORAGE_VERIFY_SUMMARY_KEY, summary)
  logger.info(
    `storage verify complete: checked=${summary.checked} missingRenditions=${summary.missingRenditions} missingCuts=${summary.missingCuts} missingThumbs=${summary.missingThumbs} missingSources=${summary.missingSources} repaired=${summary.repaired}`,
  )
}

async function selectVerifyClip(clipId: string): Promise<VerifyClipRow | null> {
  const [row] = await db
    .select({
      id: clip.id,
      sourceKey: clip.source_key,
      cutKey: clip.cut_key,
      thumbKey: clip.thumb_key,
      encodeFingerprint: clip.encode_fingerprint,
      height: clip.height,
      sourceFps: clip.source_fps,
      sourceContentType: clip.source_content_type,
      sourceCodecs: clip.source_codecs,
      trimStartMs: clip.trim_start_ms,
      trimEndMs: clip.trim_end_ms,
    })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ?? null
}

function selectVerifyRenditions(clipId: string): Promise<VerifyRenditionRow[]> {
  return db
    .select({
      id: clipRendition.id,
      storageKey: clipRendition.storage_key,
    })
    .from(clipRendition)
    .where(eq(clipRendition.clip_id, clipId))
}

async function objectExists(
  key: string,
  summary: VerifyClipAssetsSummary,
): Promise<boolean> {
  summary.checked += 1
  return Boolean(await clipStorageForKey(key).resolve(key))
}

async function quarantineMissingSource(options: {
  row: VerifyClipRow
  failed: boolean
}): Promise<boolean> {
  const [updated] = await db
    .update(clip)
    .set({
      failure_reason: SOURCE_MISSING_REASON,
      encode_failed_fingerprint: sql`coalesce(${failedFingerprint(options.row)}, ${clip.encode_failed_fingerprint})`,
      ...(options.failed ? { status: "failed" as const } : {}),
      updated_at: new Date(),
    })
    .where(verifyClipGuard(options.row))
    .returning({ id: clip.id })
  return Boolean(updated)
}

function repairMissingDerivedAssets(options: {
  row: VerifyClipRow
  missingRenditions: VerifyRenditionRow[]
  cutMissing: boolean
  thumbMissing: boolean
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(clip)
      .set({
        ...(options.cutMissing ? { cut_key: null } : {}),
        ...(options.thumbMissing ? { thumb_key: null } : {}),
        encode_fingerprint: null,
        updated_at: new Date(),
      })
      .where(verifyDerivedAssetRepairGuard(options.row))
      .returning({ id: clip.id })
    if (!updated) return false

    if (options.missingRenditions.length > 0) {
      await tx.delete(clipRendition).where(
        inArray(
          clipRendition.id,
          options.missingRenditions.map((rendition) => rendition.id),
        ),
      )
    }
    await enqueueClipEncode(options.row.id, {
      trigger: "repair",
      priority: 70,
      tx,
    })
    return true
  })
}

function verifyClipGuard(row: VerifyClipRow) {
  return and(
    eq(clip.id, row.id),
    isNull(clip.encode_run_id),
    sql`${clip.encode_fingerprint} is not distinct from ${row.encodeFingerprint}`,
  )
}

function verifyDerivedAssetRepairGuard(row: VerifyClipRow) {
  return and(
    verifyClipGuard(row),
    sql`${clip.cut_key} is not distinct from ${row.cutKey}`,
    sql`${clip.thumb_key} is not distinct from ${row.thumbKey}`,
  )
}

function failedFingerprint(row: VerifyClipRow): string | null {
  if (row.height === null) return null
  return encodeFingerprint(configStore.get("transcoding"), {
    height: row.height,
    sourceFps: row.sourceFps,
    sourceContentType: row.sourceContentType,
    sourceCodecs: row.sourceCodecs,
    trimStartMs: row.trimStartMs,
    trimEndMs: row.trimEndMs,
  })
}

function selectVerifyPage(cursor: string | null): Promise<{ id: string }[]> {
  return db
    .select({ id: clip.id })
    .from(clip)
    .where(
      and(
        eq(clip.status, "ready"),
        isNotNull(clip.source_key),
        cursor ? gt(clip.id, cursor) : undefined,
      ),
    )
    .orderBy(clip.id)
    .limit(PAGE_SIZE)
}

function addVerifySummary(
  target: VerifyClipAssetsSummary,
  source: VerifyClipAssetsSummary,
): void {
  target.checked += source.checked
  target.missingRenditions += source.missingRenditions
  target.missingCuts += source.missingCuts
  target.missingThumbs += source.missingThumbs
  target.missingSources += source.missingSources
  target.repaired += source.repaired
}

function emptyVerifySummary(): VerifyClipAssetsSummary {
  return {
    checked: 0,
    missingRenditions: 0,
    missingCuts: 0,
    missingThumbs: 0,
    missingSources: 0,
    repaired: 0,
  }
}
