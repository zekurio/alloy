import { t } from "@alloy/contracts/schema"
import { clip, instanceSetting } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { encodeFingerprint } from "@alloy/server/media/encode-fingerprint"
import { and, eq, gt, isNotNull } from "drizzle-orm"

import { defineJobKind, type JobHandlerContext } from "../registry"
import { enqueue, type EnqueueOptions } from "../store"
import { enqueueClipEncode } from "./clip-encode"

const logger = createLogger("jobs")

const CLIP_RENDITIONS_SWEEP_KIND = "clip.renditions-sweep"
const PAGE_SIZE = 500
const SWEEP_SUMMARY_KEY = "renditionSweep"

const RenditionsSweepPayloadSchema = t
  .object({
    mode: t.enum(["stale", "force"]).$default("stale"),
  })
  .$default({ mode: "stale" })

type RenditionsSweepPayload = t.infer<typeof RenditionsSweepPayloadSchema>

interface SweepClipRow {
  id: string
  height: number | null
  sourceFps: number | null
  trimStartMs: number | null
  trimEndMs: number | null
  audioTrackFingerprint: string | null
  encodeFingerprint: string | null
  encodeFailedFingerprint: string | null
  thumbKey: string | null
  thumbFailedAt: Date | null
}

interface SweepSummary {
  finishedAt: Date
  mode: RenditionsSweepPayload["mode"]
  scanned: number
  upToDate: number
  enqueued: number
  unprobed: number
  quarantined: number
}

defineJobKind({
  kind: CLIP_RENDITIONS_SWEEP_KIND,
  queue: "maintenance",
  schema: RenditionsSweepPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 1, backoffMs: 60_000 },
  handler: runRenditionsSweep,
})

export function enqueueRenditionsSweep(
  mode: RenditionsSweepPayload["mode"],
  options: Pick<EnqueueOptions, "runAt"> = {},
): Promise<string> {
  return enqueue(
    CLIP_RENDITIONS_SWEEP_KIND,
    { mode },
    {
      dedupKey: CLIP_RENDITIONS_SWEEP_KIND,
      priority: 50,
      runAt: options.runAt,
    },
  )
}

async function runRenditionsSweep(
  payload: RenditionsSweepPayload,
  ctx: JobHandlerContext,
): Promise<void> {
  const config = configStore.get("transcoding")
  const summary: SweepSummary = {
    finishedAt: new Date(),
    mode: payload.mode,
    scanned: 0,
    upToDate: 0,
    enqueued: 0,
    unprobed: 0,
    quarantined: 0,
  }
  let cursor: string | null = null

  for (;;) {
    if (ctx.signal.aborted) break
    const page = await selectSweepPage(cursor)
    if (page.length === 0) break
    cursor = page[page.length - 1]?.id ?? cursor

    if (payload.mode === "force") {
      for (const row of page) {
        summary.scanned += 1
        await enqueueClipEncode(row.id, { trigger: "reencode", priority: 90 })
        summary.enqueued += 1
      }
      continue
    }

    for (const row of page) {
      summary.scanned += 1
      if (row.height === null || row.sourceFps === null) {
        summary.unprobed += 1
        continue
      }

      const facts = {
        height: row.height,
        sourceFps: row.sourceFps,
        trimStartMs: row.trimStartMs,
        trimEndMs: row.trimEndMs,
        audioTrackFingerprint: row.audioTrackFingerprint,
      }
      const expected = encodeFingerprint(config, facts)
      if (row.encodeFingerprint === expected) {
        if (needsThumbnail(row)) {
          await enqueueClipEncode(row.id, { trigger: "sweep", priority: 90 })
          summary.enqueued += 1
        } else {
          summary.upToDate += 1
        }
        continue
      }

      if (row.encodeFailedFingerprint === expected) {
        summary.quarantined += 1
        continue
      }

      await enqueueClipEncode(row.id, { trigger: "sweep", priority: 90 })
      summary.enqueued += 1
    }
  }

  if (ctx.signal.aborted) return

  summary.finishedAt = new Date()
  await writeSweepSummary(summary)
  logger.info(
    `rendition sweep complete: mode=${summary.mode} scanned=${summary.scanned} upToDate=${summary.upToDate} enqueued=${summary.enqueued} unprobed=${summary.unprobed} quarantined=${summary.quarantined}`,
  )
}

async function selectSweepPage(cursor: string | null): Promise<SweepClipRow[]> {
  return db
    .select({
      id: clip.id,
      height: clip.height,
      sourceFps: clip.source_fps,
      trimStartMs: clip.trim_start_ms,
      trimEndMs: clip.trim_end_ms,
      audioTrackFingerprint: clip.audio_track_fingerprint,
      encodeFingerprint: clip.encode_fingerprint,
      encodeFailedFingerprint: clip.encode_failed_fingerprint,
      thumbKey: clip.thumb_key,
      thumbFailedAt: clip.thumb_failed_at,
    })
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

function needsThumbnail(row: SweepClipRow): boolean {
  return row.thumbKey === null && row.thumbFailedAt === null
}

async function writeSweepSummary(summary: SweepSummary): Promise<void> {
  await db
    .insert(instanceSetting)
    .values({ key: SWEEP_SUMMARY_KEY, value: summary, updated_at: new Date() })
    .onConflictDoUpdate({
      target: instanceSetting.key,
      set: { value: summary, updated_at: new Date() },
    })
}
