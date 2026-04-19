import { promises as fsp } from "node:fs"
import path from "node:path"

import { eq } from "drizzle-orm"
import type { PgBoss } from "pg-boss"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { configStore } from "../lib/config-store"
import { clipAssetKey } from "../storage"
import { FsStorageDriver } from "../storage/fs-driver"
import { storage } from "../storage"
import { encode, probe, thumbnail } from "./ffmpeg"

/**
 * pg-boss worker that drives a clip from `uploaded` to `ready` (or
 * `failed`). One queue, one job name, one payload.
 *
 *   payload: { clipId: string }
 *
 * Lifecycle inside the handler:
 *   1. Load row; bail if status is unexpected (idempotent re-runs).
 *   2. Mark `encoding`, reset progress.
 *   3. ffprobe → write durationMs/width/height.
 *   4. ffmpeg → encoded mp4 lands at the `video` storage key. Progress
 *      is written back to `clip.encodeProgress`, throttled to ~2s.
 *   5. ffmpeg poster + small thumbnail → write thumbKey, thumbSmallKey.
 *   6. Mark `ready`, progress 100.
 *
 * On any throw inside the handler pg-boss retries (queue-level
 * configuration: 2 retries, 30s base, exponential). We detect the
 * terminal attempt by reading `retryCount` against `RETRY_LIMIT` from
 * the job metadata — when they match, we flip status='failed' and write
 * `failureReason` so the UI has something to show. (pg-boss v12 doesn't
 * surface a typed `failed` event we can hook into; doing the check
 * inside the handler keeps the failure path on the same code path as
 * the success path.)
 */

export const ENCODE_JOB = "clip.encode" as const

const RETRY_LIMIT = 2

interface EncodeJobData {
  clipId: string
}

export async function registerEncodeWorker(boss: PgBoss): Promise<void> {
  // Queue-level defaults — `send()` calls inherit these unless they
  // override per-job. Concrete numbers are mostly insurance: the
  // common failure mode is "ffmpeg said no" which retries won't fix,
  // but transient I/O / disk pressure does benefit from a backoff.
  await boss.createQueue(ENCODE_JOB, {
    policy: "standard",
    retryLimit: RETRY_LIMIT,
    retryDelay: 30,
    retryBackoff: true,
    // 1 hour to encode a single clip — plenty for the configured
    // upload cap (default 4 GB).
    expireInSeconds: 60 * 60,
  })

  // Concurrency is read from runtime config at registration time. Admin
  // changes to `limits.queueConcurrency` won't take effect until the
  // next process restart — pg-boss work registration is one-shot in v12
  // and re-registering mid-flight would race in-progress jobs. The
  // admin UI surfaces this as a "restart required" hint.
  const concurrency = configStore.get("limits").queueConcurrency

  await boss.work<EncodeJobData>(
    ENCODE_JOB,
    {
      includeMetadata: true,
      // localConcurrency caps the number of jobs this worker process
      // pulls in parallel — ffmpeg is CPU-heavy so default to 1.
      localConcurrency: concurrency,
      batchSize: 1,
    },
    async (jobs) => {
      // batchSize=1, but the handler signature is always an array.
      const job = jobs[0]
      if (!job) return
      const clipId = job.data.clipId
      try {
        await runEncode(clipId)
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Encode failed"
        // Always record the latest reason so the UI has something to
        // show during retries; only flip status='failed' when this was
        // the last attempt (pg-boss won't redeliver after this).
        if (job.retryCount >= RETRY_LIMIT) {
          await markFailed(clipId, reason)
        } else {
          await recordFailureReason(clipId, reason)
        }
        // Rethrow so pg-boss records the attempt and schedules the
        // retry (or marks the job permanently failed).
        throw err
      }
    }
  )
}

async function runEncode(clipId: string): Promise<void> {
  const [row] = await db.select().from(clip).where(eq(clip.id, clipId)).limit(1)
  if (!row) {
    // Row was deleted between the finalize call and the worker pickup.
    // Nothing to do — let pg-boss mark the job complete.
    return
  }
  // Idempotent re-runs: only act on rows that are actually waiting on us.
  // 'encoding' is allowed because a crash mid-encode would leave the row
  // there and pg-boss will redeliver the same job.
  if (row.status !== "uploaded" && row.status !== "encoding") {
    return
  }

  const sourceKey = row.storageKey
  const videoKey = clipAssetKey(clipId, "video")
  const thumbKey = clipAssetKey(clipId, "thumb")
  const thumbSmallKey = clipAssetKey(clipId, "thumb-small")

  // The encoder writes to a real local file path. For the fs driver we
  // can resolve `storageKey` to a path directly; once we add S3 we'll
  // download into a tmp dir first. Encapsulating the call site here
  // (`localPathFor`) keeps the worker driver-agnostic up to that swap.
  const sourcePath = localPathFor(sourceKey)
  const videoPath = localPathFor(videoKey)
  const thumbPath = localPathFor(thumbKey)
  const thumbSmallPath = localPathFor(thumbSmallKey)

  await fsp.mkdir(path.dirname(videoPath), { recursive: true })

  await db
    .update(clip)
    .set({
      status: "encoding",
      encodeProgress: 0,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))

  const probed = await probe(sourcePath)

  // Honour the trim window the user picked in the upload modal, if it's
  // a valid sub-range of the source. Anything out of bounds is ignored
  // (defensive — the route already validates, but a hand-edited row
  // shouldn't crash the encoder).
  const trimRequested =
    row.trimStartMs != null &&
    row.trimEndMs != null &&
    row.trimStartMs >= 0 &&
    row.trimEndMs > row.trimStartMs
  const effectiveTrimStart = trimRequested ? (row.trimStartMs as number) : null
  const effectiveTrimEnd = trimRequested
    ? Math.min(row.trimEndMs as number, probed.durationMs)
    : null
  const outputDurationMs =
    effectiveTrimStart != null && effectiveTrimEnd != null
      ? Math.max(1, effectiveTrimEnd - effectiveTrimStart)
      : probed.durationMs

  await db
    .update(clip)
    .set({
      // The probe gives us the source's metadata. Width/height carry
      // straight through; durationMs reflects the *output* (trim-aware)
      // so the queue/feed shows the playable length, not the upload's.
      durationMs: outputDurationMs,
      width: probed.width,
      height: probed.height,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))

  // Throttle progress writes — ffmpeg emits a `-progress` line every
  // ~half second; we don't need to UPDATE the row that often.
  let lastWrittenPct = 0
  let lastWriteAt = 0
  const writeProgress = (pct: number) => {
    const now = Date.now()
    if (pct <= lastWrittenPct) return
    if (now - lastWriteAt < 2000 && pct < 99) return
    lastWrittenPct = pct
    lastWriteAt = now
    void db
      .update(clip)
      .set({ encodeProgress: pct, updatedAt: new Date() })
      .where(eq(clip.id, clipId))
  }

  // Encoder config (codec, hwaccel, quality, etc.) is admin-tunable
  // at runtime — read it fresh per job so changes apply to the *next*
  // job without a restart. Jobs already in flight finish on the config
  // they were dispatched with; that's by design.
  const encoderConfig = configStore.get("encoder")

  await encode(sourcePath, videoPath, {
    config: encoderConfig,
    // Pass the trimmed length so the progress percentage tracks the
    // right denominator — without it the bar would crawl to ~30% and
    // jump to "done" on a heavily trimmed source.
    durationMs: outputDurationMs,
    onProgress: writeProgress,
    trimStartMs: effectiveTrimStart,
    trimEndMs: effectiveTrimEnd,
  })

  // Thumbnails are produced client-side now (captured from a canvas in
  // the upload modal) and uploaded alongside the source. /finalize
  // verifies both blobs landed, so by the time this worker runs the
  // poster and small thumb already exist at the expected keys.
  //
  // We still fall back to ffmpeg if the bytes are somehow missing
  // (hand-edited row, stray deletion, pre-client-thumbnail rows that
  // already live in the DB) — a thumbnail failure stays best-effort and
  // never fails the clip.
  let thumbStored = false
  try {
    const [thumbHit, thumbSmallHit] = await Promise.all([
      storage.resolve(thumbKey),
      storage.resolve(thumbSmallKey),
    ])
    if (thumbHit && thumbSmallHit) {
      thumbStored = true
    } else {
      await fsp.mkdir(path.dirname(thumbPath), { recursive: true })
      // Sample one second into the *trimmed* window if a trim was
      // applied, otherwise one second into the source. Without this, a
      // poster would come from pre-trim content the user explicitly cut
      // out.
      const baseSec = (effectiveTrimStart ?? 0) / 1000
      const thumbAt = Math.min(
        baseSec + 1,
        // Stay strictly inside the playable window so ffmpeg always has
        // a frame to grab (clamping below the last 100ms is just a
        // safety margin against EOF on very short clips).
        Math.max(0, (effectiveTrimEnd ?? probed.durationMs) / 1000 - 0.1)
      )
      if (!thumbHit) {
        await thumbnail(sourcePath, thumbPath, { width: 640, atSeconds: thumbAt })
      }
      if (!thumbSmallHit) {
        await thumbnail(sourcePath, thumbSmallPath, { width: 160, atSeconds: thumbAt })
      }
      thumbStored = true
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[queue] thumbnail generation failed for ${clipId}:`, err)
  }

  // Stat the encoded output so sizeBytes reflects what's actually on
  // disk after encoding (the source size landed during finalize).
  const videoStat = await fsp.stat(videoPath)

  await db
    .update(clip)
    .set({
      status: "ready",
      encodeProgress: 100,
      sizeBytes: videoStat.size,
      thumbKey: thumbStored ? thumbKey : null,
      thumbSmallKey: thumbStored ? thumbSmallKey : null,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
}

async function markFailed(clipId: string, reason: string): Promise<void> {
  try {
    await db
      .update(clip)
      .set({
        status: "failed",
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[queue] failed to mark clip ${clipId} as failed:`, err)
  }
}

/**
 * Record the most recent failure reason without flipping status to
 * `failed` — used during retries so the queue row's detail line
 * reflects the latest error while the row itself stays in `encoding`
 * pending the next attempt.
 */
async function recordFailureReason(clipId: string, reason: string): Promise<void> {
  try {
    await db
      .update(clip)
      .set({
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[queue] failed to record failure reason for ${clipId}:`, err)
  }
}

/**
 * Translate a storage key into a local path. Only the fs driver supports
 * this directly; for S3 we'd download into a tmp dir and return that
 * path instead. Centralising it here means the rest of the worker stays
 * driver-agnostic.
 */
function localPathFor(key: string): string {
  if (storage instanceof FsStorageDriver) {
    return storage.fullPath(key)
  }
  throw new Error(
    "Encoder needs a local source; S3 driver requires a download step that isn't implemented yet"
  )
}
