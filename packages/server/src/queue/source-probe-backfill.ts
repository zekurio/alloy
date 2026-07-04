import { rm } from "node:fs/promises"

import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { mp4Layout, remuxToFastStart } from "@alloy/server/media/mp4-layout"
import { probeMedia, sourceCodecsString } from "@alloy/server/media/probe"
import { join } from "@alloy/server/runtime/path"
import { clipStorage } from "@alloy/server/storage/index"
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm"

import { runScopedSourceKey } from "./media-asset-keys"
import { makeMediaWorkDir } from "./media-run-helpers"

const logger = createLogger("queue")

let backfillStarted = false
let backfillStopped = false

/**
 * Fill source probe metadata for clips ingested before the source-first
 * pipeline: RFC 6381 `source_codecs` and `source_duration_ms`, plus a
 * faststart remux for MP4 sources whose moov trails the media (they seek
 * poorly as the Source playback tier). Probe-only — renditions are never
 * touched, so this stays cheap enough to run through a whole library on
 * boot. Keyed on `source_duration_ms IS NULL` because every probe yields a
 * duration, while codecs can legitimately stay null for unknown streams.
 */
export function startSourceProbeBackfill(): void {
  if (backfillStarted) return
  backfillStarted = true
  void runSourceProbeBackfill().catch((err) => {
    logger.error("source probe backfill failed:", err)
  })
}

export function stopSourceProbeBackfill(): void {
  backfillStopped = true
}

async function runSourceProbeBackfill(): Promise<void> {
  let afterId: string | null = null
  let scanned = 0
  let updated = 0
  let remuxed = 0
  while (!backfillStopped) {
    const row = await nextBackfillRow(afterId)
    if (!row) break
    afterId = row.id
    scanned += 1
    const result = await backfillSourceProbe(row).catch((err: unknown) => {
      logger.warn(`source probe backfill failed for clip ${row.id}:`, err)
      return null
    })
    if (!result) continue
    updated += 1
    if (result.remuxed) remuxed += 1
  }
  logger.info(
    `source probe backfill ${backfillStopped ? "stopped" : "complete"}: scanned ${scanned}, updated ${updated}, remuxed ${remuxed}`,
  )
}

type BackfillRow = {
  id: string
  sourceKey: string
  sourceContentType: string | null
}

async function nextBackfillRow(
  afterId: string | null,
): Promise<BackfillRow | null> {
  const [row] = await db
    .select({
      id: clip.id,
      sourceKey: clip.source_key,
      sourceContentType: clip.source_content_type,
    })
    .from(clip)
    .where(
      and(
        eq(clip.status, "ready"),
        isNotNull(clip.source_key),
        isNull(clip.source_duration_ms),
        afterId ? gt(clip.id, afterId) : undefined,
      ),
    )
    .orderBy(clip.id)
    .limit(1)
  if (!row?.sourceKey) return null
  return { ...row, sourceKey: row.sourceKey }
}

async function backfillSourceProbe(
  row: BackfillRow,
): Promise<{ remuxed: boolean } | null> {
  const workDir = await makeMediaWorkDir(`probe-${row.id}`)
  try {
    const sourcePath = join(workDir, "source")
    await clipStorage.downloadToFile(row.sourceKey, sourcePath)

    let probePath = sourcePath
    let remuxedKey: string | null = null
    if (
      row.sourceContentType === "video/mp4" &&
      (await mp4Layout(sourcePath)) === "trailing-moov"
    ) {
      const remuxedPath = join(workDir, "source-faststart.mp4")
      await remuxToFastStart(sourcePath, remuxedPath)
      probePath = remuxedPath
      remuxedKey = runScopedSourceKey(row.id, crypto.randomUUID())
    }

    const probe = await probeMedia(probePath)
    const uploaded = remuxedKey
      ? await clipStorage.uploadFromFile(probePath, remuxedKey, "video/mp4")
      : null

    // Guarded on the row still being idle with the same source so a trim run
    // that started meanwhile (which writes this metadata itself) wins.
    const [accepted] = await db
      .update(clip)
      .set({
        source_codecs: sourceCodecsString(probe),
        source_duration_ms: probe.durationMs,
        ...(remuxedKey && uploaded
          ? { source_key: remuxedKey, source_size_bytes: uploaded.size }
          : {}),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(clip.id, row.id),
          eq(clip.status, "ready"),
          isNull(clip.encode_run_id),
          eq(clip.source_key, row.sourceKey),
        ),
      )
      .returning({ id: clip.id })
    if (!accepted) {
      if (remuxedKey) await clipStorage.delete(remuxedKey)
      return null
    }

    if (remuxedKey) await clipStorage.delete(row.sourceKey)
    return { remuxed: remuxedKey !== null }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
