import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { encodeFingerprint } from "@alloy/server/media/encode-fingerprint"
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm"
import { z } from "zod"

import { defineJobKind, type JobHandlerContext } from "../registry"
import { enqueue, type EnqueueOptions } from "../store"
import { enqueueClipEncode, hasLiveClipEncodeJob } from "./clip-encode"

const CLIP_THUMBNAIL_SWEEP_KIND = "clip.thumbnail-sweep"
const EVERY_DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 500

const ThumbnailSweepPayloadSchema = z
  .object({
    mode: z.enum(["stale", "force"]).default("stale"),
  })
  .default({ mode: "stale" })

type ThumbnailSweepPayload = z.infer<typeof ThumbnailSweepPayloadSchema>

interface ThumbnailSweepRow {
  id: string
  height: number | null
  sourceFps: number | null
  sourceContentType: string | null
  sourceCodecs: string | null
  trimStartMs: number | null
  trimEndMs: number | null
  thumbFailedAt: Date | null
  encodeFailedFingerprint: string | null
}

const logger = createLogger("jobs")

defineJobKind({
  kind: CLIP_THUMBNAIL_SWEEP_KIND,
  queue: "maintenance",
  schema: ThumbnailSweepPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 1, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_DAY_MS, runAtBoot: true },
  handler: runThumbnailSweep,
})

export function enqueueThumbnailSweep(
  mode: ThumbnailSweepPayload["mode"],
  options: Pick<EnqueueOptions, "runAt"> = {},
): Promise<string> {
  return enqueue(
    CLIP_THUMBNAIL_SWEEP_KIND,
    { mode },
    {
      dedupKey: CLIP_THUMBNAIL_SWEEP_KIND,
      priority: 50,
      runAt: options.runAt,
    },
  )
}

async function runThumbnailSweep(
  payload: ThumbnailSweepPayload,
  ctx: JobHandlerContext,
): Promise<void> {
  const config = configStore.get("transcoding")
  const summary = { enqueued: 0, live: 0, quarantined: 0 }
  let cursor: string | null = null

  for (;;) {
    if (ctx.signal.aborted) break
    const page = await selectThumbnailSweepPage(cursor, payload.mode)
    if (page.length === 0) break
    cursor = page[page.length - 1]?.id ?? cursor

    for (const row of page) {
      if (await hasLiveClipEncodeJob(row.id)) {
        summary.live += 1
        continue
      }
      if (row.height !== null && row.sourceFps !== null) {
        const expected = encodeFingerprint(config, {
          height: row.height,
          sourceFps: row.sourceFps,
          sourceContentType: row.sourceContentType,
          sourceCodecs: row.sourceCodecs,
          trimStartMs: row.trimStartMs,
          trimEndMs: row.trimEndMs,
        })
        if (row.encodeFailedFingerprint === expected) {
          summary.quarantined += 1
          continue
        }
      }
      if (payload.mode === "force" && row.thumbFailedAt) {
        await clearThumbFailure(row.id)
      }
      await enqueueClipEncode(row.id, { trigger: "sweep", priority: 90 })
      summary.enqueued += 1
    }
  }

  if (ctx.signal.aborted) return
  logger.info(
    `thumbnail sweep complete: mode=${payload.mode} enqueued=${summary.enqueued} live=${summary.live} quarantined=${summary.quarantined}`,
  )
}

async function selectThumbnailSweepPage(
  cursor: string | null,
  mode: ThumbnailSweepPayload["mode"],
): Promise<ThumbnailSweepRow[]> {
  return db
    .select({
      id: clip.id,
      height: clip.height,
      sourceFps: clip.source_fps,
      sourceContentType: clip.source_content_type,
      sourceCodecs: clip.source_codecs,
      trimStartMs: clip.trim_start_ms,
      trimEndMs: clip.trim_end_ms,
      thumbFailedAt: clip.thumb_failed_at,
      encodeFailedFingerprint: clip.encode_failed_fingerprint,
    })
    .from(clip)
    .where(
      and(
        eq(clip.status, "ready"),
        isNotNull(clip.source_key),
        isNull(clip.thumb_key),
        mode === "stale" ? isNull(clip.thumb_failed_at) : undefined,
        cursor ? gt(clip.id, cursor) : undefined,
      ),
    )
    .orderBy(clip.id)
    .limit(PAGE_SIZE)
}

async function clearThumbFailure(id: string): Promise<void> {
  await db
    .update(clip)
    .set({ thumb_failed_at: null, updated_at: new Date() })
    .where(
      and(
        eq(clip.id, id),
        eq(clip.status, "ready"),
        isNull(clip.thumb_key),
        isNotNull(clip.thumb_failed_at),
        isNull(clip.encode_run_id),
      ),
    )
}
